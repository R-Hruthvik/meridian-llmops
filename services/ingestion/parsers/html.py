"""HTML parser (BeautifulSoup): strip scripts/styles/nav, keep heading structure."""

from packages.core.models import DocumentFormat
from services.ingestion.parsers.base import Block, ParsedDocument


def parse_html(content: str, title: str = "") -> ParsedDocument:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(content, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "noscript", "svg"]):
        tag.decompose()

    blocks: list[Block] = []
    page_title = ""
    if soup.title and soup.title.string:
        page_title = soup.title.string.strip()
    for element in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre", "table"]):
        name = element.name
        text = element.get_text(" ", strip=True)
        if not text:
            continue
        if name.startswith("h") and len(name) == 2:
            blocks.append(Block(kind="heading", text=text, level=int(name[1])))
        elif name == "li":
            blocks.append(Block(kind="list", text=f"- {text}"))
        elif name == "pre":
            blocks.append(Block(kind="code", text=text))
        elif name == "table":
            rows = [
                " | ".join(cell.get_text(" ", strip=True) for cell in row.find_all(["td", "th"]))
                for row in element.find_all("tr")
            ]
            rows = [row for row in rows if row.strip(" |")]
            if rows:
                blocks.append(Block(kind="table", text="\n".join(rows)))
        else:
            blocks.append(Block(kind="paragraph", text=text))

    first_heading = next((b.text for b in blocks if b.kind == "heading"), "")
    return ParsedDocument(
        title=title or page_title or first_heading or "Untitled document",
        format=DocumentFormat.HTML,
        blocks=blocks,
    )
