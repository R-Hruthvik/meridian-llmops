"""Behavior tests for bounded local-first PDF OCR."""

from types import SimpleNamespace

from services.ingestion.parsers import pdf_ocr


class _Image:
    width = 600
    height = 800

    def convert(self, _mode):
        return self

    def save(self, output, format, **_kwargs):
        assert format == "JPEG"
        output.write(b"page-image")


def test_page_ocr_renders_only_requested_page_and_prefers_tesseract(monkeypatch):
    render_calls = []
    monkeypatch.setitem(
        __import__("sys").modules,
        "pdf2image",
        SimpleNamespace(convert_from_bytes=lambda *args, **kwargs: render_calls.append((args, kwargs)) or [_Image()]),
    )
    monkeypatch.setitem(
        __import__("sys").modules,
        "pytesseract",
        SimpleNamespace(image_to_string=lambda *_args, **_kwargs: "Local OCR recovered a readable scanned page."),
    )
    monkeypatch.setattr(
        "packages.core.settings.get_settings",
        lambda: SimpleNamespace(ocr_api_key=SimpleNamespace(get_secret_value=lambda: "")),
    )

    result = pdf_ocr.ocr_page_text(b"pdf", 2, 612, 792, deadline=pdf_ocr.time.monotonic() + 60)

    assert result == "Local OCR recovered a readable scanned page."
    kwargs = render_calls[0][1]
    assert (kwargs["first_page"], kwargs["last_page"]) == (2, 2)
    assert kwargs["thread_count"] == 1
    assert kwargs["size"] == 1200
    assert kwargs["timeout"] <= 20


def test_poor_local_ocr_uses_page_image_api_key_in_header_not_url(monkeypatch):
    monkeypatch.setitem(
        __import__("sys").modules,
        "pdf2image",
        SimpleNamespace(convert_from_bytes=lambda *_args, **_kwargs: [_Image()]),
    )
    monkeypatch.setitem(
        __import__("sys").modules,
        "pytesseract",
        SimpleNamespace(image_to_string=lambda *_args, **_kwargs: "%%%"),
    )
    monkeypatch.setattr(
        "packages.core.settings.get_settings",
        lambda: SimpleNamespace(ocr_api_key=SimpleNamespace(get_secret_value=lambda: "secret-value")),
    )
    captured = {}

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "OCRExitCode": 1,
                "IsErroredOnProcessing": False,
                "ParsedResults": [{"ParsedText": "Hosted OCR recovered enough readable page text."}],
            }

    class Client:
        def __init__(self, **kwargs):
            captured["client"] = kwargs

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def post(self, url, **kwargs):
            captured["url"] = url
            captured["request"] = kwargs
            return Response()

    monkeypatch.setattr("httpx.Client", Client)

    result = pdf_ocr.ocr_page_text(b"pdf", 3, 612, 792, deadline=pdf_ocr.time.monotonic() + 60)

    assert result == "Hosted OCR recovered enough readable page text."
    assert captured["url"] == pdf_ocr.OCR_API_URL
    assert captured["request"]["headers"] == {"apikey": "secret-value"}
    assert "secret-value" not in captured["url"]
    assert captured["client"]["follow_redirects"] is False
    assert captured["request"]["files"]["file"][0] == "page-3.jpg"


def test_low_quality_hosted_ocr_is_rejected(monkeypatch):
    monkeypatch.setitem(
        __import__("sys").modules,
        "pdf2image",
        SimpleNamespace(convert_from_bytes=lambda *_args, **_kwargs: [_Image()]),
    )
    monkeypatch.setitem(
        __import__("sys").modules,
        "pytesseract",
        SimpleNamespace(image_to_string=lambda *_args, **_kwargs: "%%%"),
    )
    monkeypatch.setattr(
        "packages.core.settings.get_settings",
        lambda: SimpleNamespace(ocr_api_key=SimpleNamespace(get_secret_value=lambda: "secret-value")),
    )

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "OCRExitCode": 1,
                "IsErroredOnProcessing": False,
                "ParsedResults": [{"ParsedText": "%%%"}],
            }

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def post(self, *_args, **_kwargs):
            return Response()

    monkeypatch.setattr("httpx.Client", Client)

    assert pdf_ocr.ocr_page_text(b"pdf", 1, 612, 792, deadline=pdf_ocr.time.monotonic() + 60) is None


def test_ocr_api_key_setting_is_secret_and_blank_by_default(monkeypatch):
    from packages.core.settings import Settings

    monkeypatch.delenv("OCR_API_KEY", raising=False)
    assert Settings(_env_file=None).ocr_api_key.get_secret_value() == ""
    assert Settings(_env_file=None, OCR_API_KEY="free-key").ocr_api_key.get_secret_value() == "free-key"
    assert "free-key" not in repr(Settings(_env_file=None, OCR_API_KEY="free-key"))
