"""UPnP/DLNA discovery and playback control service."""

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Store discovered renderers in memory
_renderers: dict[str, dict] = {}


async def discover_renderers(timeout: int = 5) -> list[dict]:
    """
    Discover UPnP/DLNA media renderers on the local network.

    Returns:
        List of dicts with name, location, and udn.
    """
    global _renderers
    _renderers.clear()

    try:
        from async_upnp_client.search import async_search
        from async_upnp_client.aiohttp import AiohttpRequester
        from async_upnp_client.client_factory import UpnpFactory

        requester = AiohttpRequester()
        factory = UpnpFactory(requester)

        devices = []

        async def on_device_found(headers: dict):
            """Callback when a UPnP device is found via SSDP."""
            location = headers.get("location", "")
            if not location:
                return

            try:
                device = await factory.async_create_device(location)
                # Check if it's a media renderer
                if device.device_type and "MediaRenderer" in device.device_type:
                    renderer = {
                        "name": device.friendly_name or "Unknown Renderer",
                        "location": location,
                        "udn": device.udn or location,
                    }
                    _renderers[renderer["udn"]] = renderer
                    devices.append(renderer)
            except Exception as e:
                logger.debug(f"Could not create device from {location}: {e}")

        # Search for media renderers
        await async_search(
            search_target="urn:schemas-upnp-org:device:MediaRenderer:1",
            timeout=timeout,
            async_callback=on_device_found,
        )

        return list(_renderers.values())

    except ImportError:
        logger.warning("async-upnp-client not available, using fallback discovery")
        return await _fallback_discover(timeout)
    except Exception as e:
        logger.error(f"UPnP discovery error: {e}")
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

        # Set the URI
        set_uri = av_transport.action("SetAVTransportURI")
        await set_uri.async_call(
            InstanceID=0,
            CurrentURI=media_url,
            CurrentURIMetaData="",
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
    renderer = _renderers.get(renderer_udn)
    if not renderer:
        return False

    try:
        from async_upnp_client.aiohttp import AiohttpRequester
        from async_upnp_client.client_factory import UpnpFactory

        requester = AiohttpRequester()
        factory = UpnpFactory(requester)
        device = await factory.async_create_device(renderer["location"])

        av_transport = None
        for service in device.services.values():
            if "AVTransport" in service.service_type:
                av_transport = service
                break

        if av_transport:
            stop_action = av_transport.action("Stop")
            await stop_action.async_call(InstanceID=0)
            return True
        return False
    except Exception as e:
        logger.error(f"UPnP stop error: {e}")
        return False
