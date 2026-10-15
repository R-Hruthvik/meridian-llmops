"""Server-Sent Events contract for the streaming query endpoint."""


def test_sse_event_encodes_named_frame():
    from services.rag_engine.routers.api import _sse_event

    frame = _sse_event("token", {"delta": "Hi"})
    assert frame == 'event: token\ndata: {"delta": "Hi"}\n\n'


def test_sse_event_terminates_frame_with_blank_line():
    from services.rag_engine.routers.api import _sse_event

    frame = _sse_event("done", {"request_id": "abc"})
    assert frame.endswith("\n\n")
    assert frame.count("\n\n") == 1
    assert frame.startswith("event: done\ndata: ")
