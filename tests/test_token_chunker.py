"""Token-aware chunking tests (D6): size guarantees, overlap, metadata, determinism."""

from itertools import pairwise

from packages.core.models import Document, DocumentFormat
from services.ingestion.chunker import (
    CHUNKER_VERSION,
    CONTEXT_HEADER_MAX_TOKENS,
    TokenAwareChunker,
    count_tokens,
    embedded_text,
)
from services.ingestion.parsers.base import Block, ParsedDocument


def make_parsed(blocks: list[Block], title: str = "Handbook") -> ParsedDocument:
    return ParsedDocument(title=title, format=DocumentFormat.MARKDOWN, blocks=blocks)


def test_count_tokens_approximates_words_and_punctuation():
    assert count_tokens("Hello, world!") == 4
    assert count_tokens("") == 0


def test_never_exceeds_max_tokens():
    chunker = TokenAwareChunker(target_tokens=350, max_tokens=450, overlap_tokens=50)
    long_paragraph = " ".join(f"sentence{index} with some words" for index in range(2000))
    parsed = make_parsed([Block(kind="paragraph", text=long_paragraph)])
    chunks = chunker.chunk_document(parsed, doc_id="d1", source="big.md")
    assert chunks
    for chunk in chunks:
        assert count_tokens(chunk.text) <= 450
        assert chunk.metadata["token_count"] <= 450


def test_overlap_never_pushes_chunks_over_maximum():
    chunker = TokenAwareChunker(target_tokens=100, max_tokens=100, overlap_tokens=50)
    text = " ".join(f"word{index}" for index in range(500))
    chunks = chunker.chunk_document(make_parsed([Block(kind="paragraph", text=text)]), "d1")
    assert len(chunks) > 1
    assert all(count_tokens(chunk.text) <= 100 for chunk in chunks)


def test_long_line_split_keeps_every_word():
    chunker = TokenAwareChunker(target_tokens=50, max_tokens=80, overlap_tokens=10)
    long_paragraph = " ".join(f"word{index}" for index in range(400))
    parsed = make_parsed([Block(kind="paragraph", text=long_paragraph)])
    chunks = chunker.chunk_document(parsed, doc_id="d1", source="big.md")
    words = set(long_paragraph.split())
    covered: set[str] = set()
    for chunk in chunks:
        covered.update(chunk.text.split())
    assert words <= covered


def test_overlap_present_when_splitting_paragraph():
    chunker = TokenAwareChunker(target_tokens=40, max_tokens=60, overlap_tokens=15)
    long_paragraph = " ".join(f"token{index}" for index in range(300))
    parsed = make_parsed([Block(kind="paragraph", text=long_paragraph)])
    chunks = chunker.chunk_document(parsed, doc_id="d1", source="big.md")
    assert len(chunks) > 2
    overlap_seen = False
    for previous, current in pairwise(chunks):
        tail = set(previous.text.split()[-15:])
        head = set(current.text.split()[:15])
        if tail & head:
            overlap_seen = True
    assert overlap_seen


def test_overlap_does_not_cross_top_level_headings():
    chunker = TokenAwareChunker(target_tokens=40, max_tokens=60, overlap_tokens=15)
    first = " ".join(f"first{index}" for index in range(180))
    second = " ".join(f"second{index}" for index in range(180))
    parsed = make_parsed([
        Block(kind="heading", text="First", level=1),
        Block(kind="paragraph", text=first),
        Block(kind="heading", text="Second", level=1),
        Block(kind="paragraph", text=second),
    ])
    chunks = chunker.chunk_document(parsed, "d1")
    second_section = [chunk for chunk in chunks if chunk.section_heading == "Second"]
    assert second_section
    assert all(not chunk.text.split()[0].startswith("first") for chunk in second_section)


def test_pages_and_headings_carried():
    chunker = TokenAwareChunker(target_tokens=100, max_tokens=150)
    body_setup = "Install the agent on every host in the cluster. " * 4
    body_ops = "Restart the service weekly and check the logs daily. " * 4
    parsed = ParsedDocument(
        title="Runbook",
        format=DocumentFormat.PDF,
        blocks=[
            Block(kind="heading", text="Setup", level=1, page=1),
            Block(kind="paragraph", text=body_setup, page=1),
            Block(kind="heading", text="Operations", level=1, page=4),
            Block(kind="paragraph", text=body_ops, page=4),
            Block(kind="paragraph", text="Check logs daily.", page=5),
        ],
    )
    chunks = chunker.chunk_document(parsed, doc_id="d1", source="runbook.pdf")
    by_heading = {c.section_heading: c for c in chunks}
    assert "Setup" in by_heading
    assert by_heading["Setup"].metadata["page_start"] == 1
    assert "Operations" in by_heading
    assert by_heading["Operations"].metadata["page_start"] == 4
    assert by_heading["Operations"].metadata["page_end"] == 5


def test_heading_path_is_the_heading_chain():
    chunker = TokenAwareChunker()
    parsed = ParsedDocument(
        title="Handbook",
        format=DocumentFormat.MARKDOWN,
        blocks=[
            Block(kind="heading", text="Leave Policy", level=1),
            Block(kind="heading", text="Sick Leave", level=2),
            Block(kind="paragraph", text="Ten days per year."),
        ],
    )
    chunks = chunker.chunk_document(parsed, doc_id="d1", source="handbook.md")
    assert chunks[0].section_heading == "Leave Policy > Sick Leave"


def test_chunk_ids_are_sequential_and_stable():
    chunker = TokenAwareChunker()
    parsed = make_parsed([Block(kind="paragraph", text="alpha beta gamma")])
    first = chunker.chunk_document(parsed, doc_id="doc-abc", source="x.md")
    second = chunker.chunk_document(parsed, doc_id="doc-abc", source="x.md")
    assert [c.id for c in first] == [c.id for c in second]
    assert first[0].id == "doc-abc-c0000"


def test_content_hash_present():
    chunker = TokenAwareChunker()
    parsed = make_parsed([Block(kind="paragraph", text="alpha beta gamma")])
    chunk = chunker.chunk_document(parsed, doc_id="d1", source="x.md")[0]
    assert len(chunk.metadata["content_hash"]) == 64


def test_small_chunks_merged_with_neighbor():
    chunker = TokenAwareChunker(target_tokens=350, max_tokens=450)
    parsed = make_parsed([
        Block(kind="heading", text="Section", level=1),
        Block(kind="paragraph", text="short"),
        Block(kind="paragraph", text="also short"),
    ])
    chunks = chunker.chunk_document(parsed, doc_id="d1", source="x.md")
    assert len(chunks) == 1
    assert "short" in chunks[0].text and "also short" in chunks[0].text


def test_leading_tiny_chunk_merges_with_same_section_neighbor():
    chunker = TokenAwareChunker(target_tokens=20, max_tokens=100, overlap_tokens=0)
    table = "\n".join(f"row{index} | value{index}" for index in range(24))
    parsed = make_parsed([
        Block(kind="heading", text="Section", level=1),
        Block(kind="paragraph", text="intro"),
        Block(kind="table", text=table),
    ])
    chunks = chunker.chunk_document(parsed, "d1")
    assert "intro" in chunks[0].text
    assert count_tokens(chunks[0].text) >= 20


def test_code_and_tables_stay_intact():
    chunker = TokenAwareChunker(target_tokens=20, max_tokens=450)
    table = "\n".join(f"row{index} | value{index}" for index in range(30))
    parsed = make_parsed([
        Block(kind="paragraph", text="intro"),
        Block(kind="table", text=table),
        Block(kind="code", text="def f():\n    return 1"),
    ])
    chunks = chunker.chunk_document(parsed, doc_id="d1", source="x.md")
    assert any(table in c.text for c in chunks)


def test_embedded_text_prefixes_title_and_heading():
    from packages.core.models import Chunk

    chunk = Chunk(
        id="d1-c0000",
        document_id="d1",
        text="body",
        section_heading="A > B",
        metadata={"title": "Doc"},
    )
    assert embedded_text(chunk) == "Doc > A > B\nbody"


def test_embedded_text_bounds_long_header_and_keeps_body():
    from packages.core.models import Chunk

    body = "This passage must remain complete."
    chunk = Chunk(
        id="d1-c0000",
        document_id="d1",
        text=body,
        section_heading=" > ".join(f"Section{index}" for index in range(120)),
        metadata={"title": "A very long document title " * 30},
    )

    result = embedded_text(chunk)
    header, text = result.split("\n", 1)
    assert count_tokens(header) <= CONTEXT_HEADER_MAX_TOKENS
    assert text == body


def test_legacy_document_path_still_chunks():
    chunker = TokenAwareChunker()
    doc = Document(
        id="d1",
        title="Doc",
        text="# Heading\n\nSome body text here.",
        format=DocumentFormat.MARKDOWN,
        source="doc.md",
    )
    chunks = chunker.chunk(doc)
    assert chunks
    assert all(c.document_id == "d1" for c in chunks)


def test_chunker_version_constant():
    assert CHUNKER_VERSION
