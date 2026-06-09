"""UPnP/DLNA discovery and playback control service."""

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Store discovered renderers in memory
_renderers: dict[str, dict] = {}


async def discover_renderers(timeout: int = 5) -> list[dict]:
    """
    Discover UPnP/DLNA media renderers on the local network with 
    robust logging and timeout handling for production Docker.
    """
    global _renderers
    _renderers.clear()
    
    # Verbose Logging for UPnP library
    import os
    from async_upnp_client.search import async_search
    from async_upnp_client.aiohttp import AiohttpRequester
    from async_upnp_client.client_factory import UpnpFactory
    import aiohttp

    logging.getLogger('async_upnp_client').setLevel(logging.DEBUG)

    # Use BIND_IP if provided (critical for Docker host mode)
    bind_ip = os.environ.get("BIND_IP", "0.0.0.0")
    logger.info(f"Starting UPnP Discovery: Timeout={timeout}s, Bind IP={bind_ip}")

    requester = AiohttpRequester()
    factory = UpnpFactory(requester)

    search_targets = [
        "urn:schemas-upnp-org:device:MediaRenderer:1",
        "urn:schemas-upnp-org:device:MediaRenderer:2",
        "ssdp:all"
    ]

    async def on_device_found(headers: dict):
        location = headers.get("location", "")
        if not location or location in [r["location"] for r in _renderers.values()]:
            return

        logger.debug(f"Found potential device at: {location}")
        try:
            # Use library's native, robust create_device with the pre-configured requester
            device = await factory.async_create_device(location)
            
            is_renderer = (
                "MediaRenderer" in (device.device_type or "") or
                any("AVTransport" in s.service_type for s in device.services.values())
            )

            if is_renderer:
                renderer = {
                    "name": device.friendly_name or f"Renderer ({location})",
                    "location": location,
                    "udn": device.udn or location,
                    "type": device.device_type
                }
                _renderers[renderer["udn"]] = renderer
                logger.info(f"MATCH: {renderer['name']} confirmed via XML.")
        except Exception as e:
            # Explicitly log the error per device URL as requested
            logger.error(f"UPnP XML Validation failed for {location}: {e}")

    try:
        # Search targets sequentially with simple, reliable parameters
        for target in search_targets:
            try:
                await async_search(
                    search_target=target,
                    timeout=timeout,
                    async_callback=on_device_found
                )
            except Exception as e:
                logger.error(f"SSDP Broadcast for {target} failed: {e}")

        return list(_renderers.values())

    except Exception as e:
        logger.error(f"Critical UPnP discovery error: {e}")
        return []


async def _fallback_discover(timeout: int = 5) -> list[dict]:
    """Fallback SSDP discovery using raw sockets."""
    import socket
    import struct

    SSDP_ADDR = "239.255.255.250"
    SSDP_PORT = 1900
    SEARCH_MSG = (
        "M-SEARCH * HTTP/1.1\r\n"
        f"HOST: {SSDP_ADDR}:{SSDP_PORT}\r\n"
        "MAN: \"ssdp:discover\"\r\n"
        f"MX: {timeout}\r\n"
        "ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n"
        "\r\n"
    )

    renderers = []
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.settimeout(timeout)
        sock.sendto(SEARCH_MSG.encode(), (SSDP_ADDR, SSDP_PORT))

        while True:
            try:
                data, addr = sock.recvfrom(4096)
                response = data.decode("utf-8", errors="ignore")
                location = ""
                for line in response.split("\r\n"):
                    if line.lower().startswith("location:"):
                        location = line.split(":", 1)[1].strip()
                        break
                if location:
                    renderer = {
                        "name": f"Renderer ({addr[0]})",
                        "location": location,
                        "udn": location,
                    }
                    _renderers[renderer["udn"]] = renderer
                    renderers.append(renderer)
            except socket.timeout:
                break
        sock.close()
    except Exception as e:
        logger.error(f"Fallback SSDP discovery error: {e}")

    return renderers


async def play_on_renderer(renderer_udn: str, media_url: str) -> bool:
    """
    Command a UPnP renderer to play the given media URL.

    Args:
        renderer_udn: The UDN or identifier of the discovered renderer.
        media_url: URL to the audio stream.

    Returns:
        True on success.
    """
    renderer = _renderers.get(renderer_udn)
    if not renderer:
        raise ValueError(f"Renderer {renderer_udn} not found. Run discovery first.")

    try:
        from async_upnp_client.aiohttp import AiohttpRequester
        from async_upnp_client.client_factory import UpnpFactory

        requester = AiohttpRequester()
        factory = UpnpFactory(requester)
        device = await factory.async_create_device(renderer["location"])

        # Find AVTransport service
        av_transport = None
        for service in device.services.values():
            if "AVTransport" in service.service_type:
                av_transport = service
                break

        if not av_transport:
            raise RuntimeError("No AVTransport service found on renderer")

        import html
        # Construct basic DIDL-Lite metadata for strict renderers
        didl_metadata = f'''<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
    <item id="0" parentID="-1" restricted="1">
        <dc:title>LexiTag Stream</dc:title>
        <upnp:class>object.item.audioItem.musicTrack</upnp:class>
        <res protocolInfo="http-get:*:audio/mpeg:*">{html.escape(media_url)}</res>
    </item>
</DIDL-Lite>'''

        # Set the URI with metadata
        set_uri = av_transport.action("SetAVTransportURI")
        await set_uri.async_call(
            InstanceID=0,
            CurrentURI=media_url,
            CurrentURIMetaData=didl_metadata,
        )

        # Play
        play_action = av_transport.action("Play")
        await play_action.async_call(InstanceID=0, Speed="1")

        return True
    except ImportError:
        logger.error("async-upnp-client required for UPnP playback")
        return False
    except Exception as e:
        logger.error(f"UPnP play error: {e}")
        return False


async def stop_renderer(renderer_udn: str) -> bool:
    """Stop playback on a UPnP renderer."""
    return await _call_av_action(renderer_udn, "Stop", InstanceID=0)


async def pause_renderer(renderer_udn: str) -> bool:
    """Pause playback on a UPnP renderer."""
    return await _call_av_action(renderer_udn, "Pause", InstanceID=0)


async def resume_renderer(renderer_udn: str) -> bool:
    """Resume playback on a UPnP renderer."""
    return await _call_av_action(renderer_udn, "Play", InstanceID=0, Speed="1")


async def seek_renderer(renderer_udn: str, seconds: float) -> bool:
    """Seek to a specific time on a UPnP renderer."""
    target = _format_time(seconds)
    logger.info(f"Seeking on {renderer_udn} to {target} ({seconds}s)")
    return await _call_av_action(
        renderer_udn, 
        "Seek", 
        InstanceID=0, 
        Unit="REL_TIME", 
        Target=target
    )


def _format_time(seconds: float) -> str:
    """Convert seconds to HH:MM:SS string."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


async def set_renderer_volume(renderer_udn: str, volume: int) -> bool:
    """Set volume on a UPnP renderer (0-100)."""
    renderer = _renderers.get(renderer_udn)
    if not renderer: return False

    try:
        from async_upnp_client.aiohttp import AiohttpRequester
        from async_upnp_client.client_factory import UpnpFactory

        requester = AiohttpRequester()
        factory = UpnpFactory(requester)
        device = await factory.async_create_device(renderer["location"])

        # Volume is usually in RenderingControl
        service = next((s for s in device.services.values() if "RenderingControl" in s.service_type), None)
        if service:
            action = service.action("SetVolume")
            await action.async_call(InstanceID=0, Channel="Master", DesiredVolume=volume)
            return True
        return False
    except Exception as e:
        logger.error(f"UPnP volume error: {e}")
        return False


async def _call_av_action(renderer_udn: str, action_name: str, **kwargs) -> bool:
    """Helper to call an action on the AVTransport service."""
    renderer = _renderers.get(renderer_udn)
    if not renderer: return False

    try:
        from async_upnp_client.aiohttp import AiohttpRequester
        from async_upnp_client.client_factory import UpnpFactory

        requester = AiohttpRequester()
        factory = UpnpFactory(requester)
        device = await factory.async_create_device(renderer["location"])

        service = next((s for s in device.services.values() if "AVTransport" in s.service_type), None)
        if service:
            action = service.action(action_name)
            await action.async_call(**kwargs)
            return True
        return False
    except Exception as e:
        logger.error(f"UPnP action {action_name} error: {e}")
        return False
