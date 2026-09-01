"""UPnP/DLNA and OpenHome discovery and playback control service."""

import asyncio
import html
import http.client
import logging
import os
import socket
import urllib.parse
from typing import Mapping, Optional

from async_upnp_client.client import UpnpRequester
from async_upnp_client.client_factory import UpnpFactory
from async_upnp_client.const import HttpRequest, HttpResponse
from async_upnp_client.search import async_search

logger = logging.getLogger(__name__)

# Store discovered renderers in memory
_renderers: dict[str, dict] = {}


class RobustRawRequester(UpnpRequester):
    """
    High-performance, reliable HTTP requester tailored for UPnP and OpenHome devices.
    Uses direct TCP stream with strict 'Connection: close' semantics, guaranteeing
    compatibility with micro-servers like upmpdcli, npupnp, libupnp, GUPnP, and smart TVs.
    """

    def __init__(self, timeout: int = 8, http_headers: Optional[Mapping[str, str]] = None):
        super().__init__()
        self._timeout = timeout
        self._headers = dict(http_headers or {})

    def _sync_http_request(self, http_request: HttpRequest) -> HttpResponse:
        parsed = urllib.parse.urlparse(http_request.url)
        host = parsed.hostname or "localhost"
        port = parsed.port or 80
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query

        headers = {
            "User-Agent": "LexiTag/0.1.7 UPnP/1.1",
            "Accept": "*/*",
            "Connection": "close",
            **self._headers,
            **(http_request.headers or {})
        }

        data = b""
        if http_request.body:
            if isinstance(http_request.body, str):
                data = http_request.body.encode("utf-8")
            else:
                data = http_request.body
            headers["Content-Length"] = str(len(data))

        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(self._timeout)
        try:
            s.connect((host, port))
            lines = [f"{http_request.method} {path} HTTP/1.1", f"Host: {host}:{port}"]
            for k, v in headers.items():
                if k.lower() != "host":
                    lines.append(f"{k}: {v}")
            req_bytes = "\r\n".join(lines).encode("utf-8") + b"\r\n\r\n" + data
            s.sendall(req_bytes)

            chunks = []
            while True:
                chunk = s.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
        finally:
            s.close()

        full_resp = b"".join(chunks)
        header_part, _, body_part = full_resp.partition(b"\r\n\r\n")
        header_lines = header_part.decode("utf-8", errors="replace").split("\r\n")
        status_line = header_lines[0] if header_lines else "HTTP/1.1 200 OK"
        status_parts = status_line.split(" ")
        status_code = int(status_parts[1]) if len(status_parts) > 1 and status_parts[1].isdigit() else 200
        resp_headers = {}
        for line in header_lines[1:]:
            if ":" in line:
                hk, hv = line.split(":", 1)
                resp_headers[hk.strip()] = hv.strip()
        body = body_part.decode("utf-8", errors="replace")
        return HttpResponse(status_code, resp_headers, body)

    async def async_http_request(self, http_request: HttpRequest) -> HttpResponse:
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                return await asyncio.to_thread(self._sync_http_request, http_request)
            except Exception as err:
                if attempt == max_attempts - 1:
                    logger.warning(
                        f"UPnP HTTP Request failed after {max_attempts} attempts "
                        f"({http_request.method} {http_request.url}): {err}"
                    )
                    raise
                await asyncio.sleep(0.2 * (attempt + 1))


def _get_factory(timeout: int = 8) -> UpnpFactory:
    """Create a non-strict UpnpFactory configured with RobustRawRequester."""
    requester = RobustRawRequester(timeout=timeout)
    return UpnpFactory(requester, non_strict=True)


async def discover_renderers(timeout: int = 5) -> list[dict]:
    """
    Discover UPnP/DLNA & OpenHome media renderers on the local network with 
    strict request deduplication and socket-level resilience.
    """
    global _renderers
    _renderers.clear()
    seen_locations: set[str] = set()

    bind_ip = os.environ.get("BIND_IP", "0.0.0.0")
    logger.info(f"Starting UPnP/OpenHome Discovery: Timeout={timeout}s, Bind IP={bind_ip}")

    factory = _get_factory(timeout=timeout)

    search_targets = [
        "urn:schemas-upnp-org:device:MediaRenderer:1",
        "urn:schemas-upnp-org:device:MediaRenderer:2",
        "urn:av-openhome-org:device:Source:1",
        "ssdp:all"
    ]

    async def on_device_found(headers: dict):
        location = (headers.get("location") or "").strip()
        if not location or location in seen_locations or location in [r["location"] for r in _renderers.values()]:
            return

        # Shield against duplicate parallel SSDP packets
        seen_locations.add(location)

        logger.debug(f"Parsing UPnP/OpenHome device at: {location}")
        try:
            device = await factory.async_create_device(location)
            device_type = device.device_type or ""
            service_types = [s.service_type for s in device.services.values()]

            is_renderer = (
                "MediaRenderer" in device_type or
                "Source" in device_type or
                "Receiver" in device_type or
                any("AVTransport" in st for st in service_types) or
                any("openhome" in st.lower() for st in service_types) or
                any("Playlist" in st for st in service_types) or
                any("Radio" in st for st in service_types) or
                any("RenderingControl" in st for st in service_types)
            )

            if is_renderer:
                renderer = {
                    "name": device.friendly_name or f"Renderer ({location})",
                    "location": location,
                    "udn": device.udn or location,
                    "type": device.device_type
                }
                _renderers[renderer["udn"]] = renderer
                logger.info(f"MATCH: {renderer['name']} ({device_type}) confirmed via XML.")
        except Exception as e:
            logger.error(f"UPnP XML Validation failed for {location}: {e}")

    try:
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


async def play_on_renderer(renderer_udn: str, media_url: str) -> bool:
    """
    Command a UPnP / OpenHome renderer to play the given media URL.

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
        factory = _get_factory(timeout=10)
        device = await factory.async_create_device(renderer["location"])

        didl_metadata = f'''<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
    <item id="0" parentID="-1" restricted="1">
        <dc:title>LexiTag Stream</dc:title>
        <upnp:class>object.item.audioItem.musicTrack</upnp:class>
        <res protocolInfo="http-get:*:audio/mpeg:*">{html.escape(media_url)}</res>
    </item>
</DIDL-Lite>'''

        # 1. Standard UPnP AVTransport service
        av_transport = next((s for s in device.services.values() if "AVTransport" in s.service_type), None)
        if av_transport:
            try:
                set_uri = av_transport.action("SetAVTransportURI")
                await set_uri.async_call(
                    InstanceID=0,
                    CurrentURI=media_url,
                    CurrentURIMetaData=didl_metadata,
                )
                play_action = av_transport.action("Play")
                await play_action.async_call(InstanceID=0, Speed="1")
                logger.info(f"Playback started on {renderer['name']} via AVTransport")
                return True
            except Exception as e:
                logger.warning(f"AVTransport play failed on {renderer['name']}: {e}")

        # 2. OpenHome Playlist service
        playlist_service = next((s for s in device.services.values() if "Playlist" in s.service_type), None)
        if playlist_service:
            try:
                if "DeleteAll" in playlist_service.actions:
                    try:
                        await playlist_service.action("DeleteAll").async_call()
                    except Exception:
                        pass
                insert_action = playlist_service.action("Insert")
                res = await insert_action.async_call(
                    AfterId=0,
                    Uri=media_url,
                    Metadata=didl_metadata
                )
                new_id = res.get("NewId", 0) if isinstance(res, dict) else 0
                if "SetId" in playlist_service.actions and new_id:
                    try:
                        await playlist_service.action("SetId").async_call(Value=new_id)
                    except Exception:
                        pass
                play_action = playlist_service.action("Play")
                await play_action.async_call()
                logger.info(f"Playback started on {renderer['name']} via OpenHome Playlist")
                return True
            except Exception as e:
                logger.warning(f"OpenHome Playlist play failed on {renderer['name']}: {e}")

        # 3. OpenHome Radio service
        radio_service = next((s for s in device.services.values() if "Radio" in s.service_type), None)
        if radio_service:
            try:
                set_uri = radio_service.action("SetUri")
                await set_uri.async_call(Uri=media_url, Metadata=didl_metadata)
                play_action = radio_service.action("Play")
                await play_action.async_call()
                logger.info(f"Playback started on {renderer['name']} via OpenHome Radio")
                return True
            except Exception as e:
                logger.warning(f"OpenHome Radio play failed on {renderer['name']}: {e}")

        raise RuntimeError("No compatible playback service (AVTransport, OpenHome Playlist, or Radio) found on renderer")

    except Exception as e:
        logger.error(f"UPnP/OpenHome play error: {e}")
        return False


async def stop_renderer(renderer_udn: str) -> bool:
    """Stop playback on a UPnP / OpenHome renderer."""
    renderer = _renderers.get(renderer_udn)
    if not renderer:
        return False

    try:
        factory = _get_factory(timeout=8)
        device = await factory.async_create_device(renderer["location"])

        av_service = next((s for s in device.services.values() if "AVTransport" in s.service_type), None)
        if av_service and "Stop" in av_service.actions:
            try:
                await av_service.action("Stop").async_call(InstanceID=0)
                return True
            except Exception as e:
                logger.debug(f"AVTransport Stop error: {e}")

        oh_service = next(
            (s for s in device.services.values() if "Playlist" in s.service_type or "Radio" in s.service_type),
            None
        )
        if oh_service and "Stop" in oh_service.actions:
            try:
                await oh_service.action("Stop").async_call()
                return True
            except Exception as e:
                logger.debug(f"OpenHome Stop error: {e}")

        return False
    except Exception as e:
        logger.error(f"UPnP stop error: {e}")
        return False


async def pause_renderer(renderer_udn: str) -> bool:
    """Pause playback on a UPnP / OpenHome renderer."""
    renderer = _renderers.get(renderer_udn)
    if not renderer:
        return False

    try:
        factory = _get_factory(timeout=8)
        device = await factory.async_create_device(renderer["location"])

        av_service = next((s for s in device.services.values() if "AVTransport" in s.service_type), None)
        if av_service and "Pause" in av_service.actions:
            try:
                await av_service.action("Pause").async_call(InstanceID=0)
                return True
            except Exception as e:
                logger.debug(f"AVTransport Pause error: {e}")

        oh_service = next(
            (s for s in device.services.values() if "Playlist" in s.service_type or "Radio" in s.service_type),
            None
        )
        if oh_service and "Pause" in oh_service.actions:
            try:
                await oh_service.action("Pause").async_call()
                return True
            except Exception as e:
                logger.debug(f"OpenHome Pause error: {e}")

        return False
    except Exception as e:
        logger.error(f"UPnP pause error: {e}")
        return False


async def resume_renderer(renderer_udn: str) -> bool:
    """Resume playback on a UPnP / OpenHome renderer."""
    renderer = _renderers.get(renderer_udn)
    if not renderer:
        return False

    try:
        factory = _get_factory(timeout=8)
        device = await factory.async_create_device(renderer["location"])

        av_service = next((s for s in device.services.values() if "AVTransport" in s.service_type), None)
        if av_service and "Play" in av_service.actions:
            try:
                await av_service.action("Play").async_call(InstanceID=0, Speed="1")
                return True
            except Exception as e:
                logger.debug(f"AVTransport Play error: {e}")

        oh_service = next(
            (s for s in device.services.values() if "Playlist" in s.service_type or "Radio" in s.service_type),
            None
        )
        if oh_service and "Play" in oh_service.actions:
            try:
                await oh_service.action("Play").async_call()
                return True
            except Exception as e:
                logger.debug(f"OpenHome Play error: {e}")

        return False
    except Exception as e:
        logger.error(f"UPnP resume error: {e}")
        return False


async def seek_renderer(renderer_udn: str, seconds: float) -> bool:
    """Seek to a specific time on a UPnP / OpenHome renderer."""
    renderer = _renderers.get(renderer_udn)
    if not renderer:
        return False

    try:
        factory = _get_factory(timeout=8)
        device = await factory.async_create_device(renderer["location"])

        target = _format_time(seconds)
        av_service = next((s for s in device.services.values() if "AVTransport" in s.service_type), None)
        if av_service and "Seek" in av_service.actions:
            try:
                await av_service.action("Seek").async_call(InstanceID=0, Unit="REL_TIME", Target=target)
                return True
            except Exception as e:
                logger.debug(f"AVTransport Seek error: {e}")

        playlist_service = next((s for s in device.services.values() if "Playlist" in s.service_type), None)
        if playlist_service and "SeekSecondAbsolute" in playlist_service.actions:
            try:
                await playlist_service.action("SeekSecondAbsolute").async_call(Value=int(seconds))
                return True
            except Exception as e:
                logger.debug(f"OpenHome Seek error: {e}")

        return False
    except Exception as e:
        logger.error(f"UPnP seek error: {e}")
        return False


def _format_time(seconds: float) -> str:
    """Convert seconds to HH:MM:SS string."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


async def set_renderer_volume(renderer_udn: str, volume: int) -> bool:
    """Set volume on a UPnP / OpenHome renderer (0-100)."""
    renderer = _renderers.get(renderer_udn)
    if not renderer:
        return False

    try:
        factory = _get_factory(timeout=8)
        device = await factory.async_create_device(renderer["location"])

        # 1. Standard UPnP RenderingControl
        rc_service = next((s for s in device.services.values() if "RenderingControl" in s.service_type), None)
        if rc_service and "SetVolume" in rc_service.actions:
            try:
                await rc_service.action("SetVolume").async_call(
                    InstanceID=0, Channel="Master", DesiredVolume=volume
                )
                return True
            except Exception as e:
                logger.debug(f"RenderingControl SetVolume error: {e}")

        # 2. OpenHome Volume
        oh_vol_service = next((s for s in device.services.values() if "Volume" in s.service_type), None)
        if oh_vol_service and "SetVolume" in oh_vol_service.actions:
            try:
                await oh_vol_service.action("SetVolume").async_call(Value=int(volume))
                return True
            except Exception as e:
                logger.debug(f"OpenHome SetVolume error: {e}")

        return False
    except Exception as e:
        logger.error(f"UPnP/OpenHome volume error: {e}")
        return False
