#!/usr/bin/env python3
"""Crop an original figure out of a paper PDF, for evidence in chat.

OpenResearch's literature skill requires showing *original* figures rather than
redrawing results, so the crop must come from the real PDF, stay legible, and
keep panel titles, axes and legends. Extracted rasters are often low-resolution
and vector diagrams are not rasters at all, so every crop is produced by
rendering the page region at high DPI.

Invoked through `scripts/paper-figure.mjs`, which supplies pymupdf via `uv`.
"""
import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

import pymupdf

CAPTION = re.compile(r"^\s*(?:Figure|Fig\.)\s*(\d{1,2})\s*[:.|]", re.IGNORECASE)
MARGIN = 26.0  # points; keeps the crop inside the text block of a two-column page


def download(arxiv_id: str) -> Path:
    """Fetch an arXiv PDF into a stable cache so repeat crops skip the download."""
    cache = Path(__file__).resolve().parent.parent / ".orx-cache" / "papers"
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / f"{arxiv_id.replace('/', '_')}.pdf"
    if target.exists() and target.stat().st_size > 1024:
        return target
    url = f"https://arxiv.org/pdf/{arxiv_id}"
    request = urllib.request.Request(url, headers={"User-Agent": "dsh-openresearch"})
    with urllib.request.urlopen(request, timeout=60) as response:
        target.write_bytes(response.read())
    return target


def captions(doc):
    """Every figure caption with its page number, for discovery."""
    found = []
    for index in range(len(doc)):
        for block in doc[index].get_text("blocks"):
            text = block[4].strip()
            match = CAPTION.match(text)
            if match:
                found.append(
                    {
                        "figure": int(match.group(1)),
                        "page": index + 1,
                        "y0": round(block[1], 1),
                        "y1": round(block[3], 1),
                        "caption": " ".join(text.split())[:160],
                    }
                )
    return found


def caption_block(doc, number):
    """Locate figure `number`'s caption block and its page."""
    for index in range(len(doc)):
        for block in doc[index].get_text("blocks"):
            match = CAPTION.match(block[4])
            if match and int(match.group(1)) == number:
                return index, block
    raise SystemExit(f"Figure {number} caption not found; try --list")


def art_clusters(page, min_width=40.0, min_height=28.0):
    """Group drawing and image geometry into visually separate clusters.

    Inferring a figure from surrounding text gaps fails on two-column pages: a
    full-width caption touches every block on the page, so the nearest text is
    always the adjoining paragraph. The art is the reliable anchor, so cluster
    it and let the caption merely choose among clusters.
    """
    rects = []
    for drawing in page.get_drawings():
        rect = drawing["rect"]
        if rect.width >= 1 or rect.height >= 1:
            rects.append(rect)
    for item in page.get_images(full=True):
        rects.extend(page.get_image_rects(item[0]))

    rects.sort(key=lambda r: (r.y0, r.x0))
    clusters = []
    for rect in rects:
        for cluster in clusters:
            # Same visual object when vertically adjacent and horizontally overlapping.
            if rect.y0 <= cluster.y1 + 12 and rect.x1 >= cluster.x0 - 4 and rect.x0 <= cluster.x1 + 4:
                cluster.x0 = min(cluster.x0, rect.x0)
                cluster.y0 = min(cluster.y0, rect.y0)
                cluster.x1 = max(cluster.x1, rect.x1)
                cluster.y1 = max(cluster.y1, rect.y1)
                break
        else:
            clusters.append(pymupdf.Rect(rect))
    return [c for c in clusters if c.width >= min_width and c.height >= min_height]


def figure_region(doc, number):
    """The art cluster nearest figure `number`'s caption."""
    index, caption = caption_block(doc, number)
    page = doc[index]
    cap = pymupdf.Rect(caption[:4])

    clusters = art_clusters(page)
    if not clusters:
        raise SystemExit(
            f"Figure {number} on page {index + 1}: no drawing or image geometry found; "
            "the figure may be a scanned raster — use --page with --box"
        )

    def gap(cluster):
        """Vertical distance between the art and its caption; 0 when they abut."""
        if cluster.y1 <= cap.y0:
            return cap.y0 - cluster.y1
        if cluster.y0 >= cap.y1:
            return cluster.y0 - cap.y1
        return 0.0

    # Nearest by vertical gap, then largest — a figure dwarfs rules and glyphs.
    best = min(clusters, key=lambda c: (round(gap(c), 1), -(c.width * c.height)))
    rect = pymupdf.Rect(
        max(page.rect.x0 + MARGIN, best.x0 - 4),
        max(page.rect.y0 + MARGIN, best.y0 - 4),
        min(page.rect.x1 - MARGIN, best.x1 + 4),
        min(page.rect.y1 - MARGIN, best.y1 + 4),
    )
    if rect.width < 40 or rect.height < 28:
        raise SystemExit(
            f"Figure {number} on page {index + 1}: detected art is too small "
            f"({rect.width:.0f}x{rect.height:.0f}pt); use --page with --box"
        )
    return index, rect


def trim(path):
    """Drop uniform white borders so the figure fills the frame."""
    from PIL import Image, ImageChops

    image = Image.open(path).convert("RGB")
    background = Image.new("RGB", image.size, (255, 255, 255))
    box = ImageChops.difference(image, background).getbbox()
    if box:
        padded = (
            max(0, box[0] - 6),
            max(0, box[1] - 6),
            min(image.width, box[2] + 6),
            min(image.height, box[3] + 6),
        )
        image = image.crop(padded)
        image.save(path)
    return image.size


def main():
    parser = argparse.ArgumentParser(description="Crop a paper figure from its PDF.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--pdf", help="path to a local PDF")
    source.add_argument("--arxiv", help="arXiv id; downloads and caches the PDF")
    parser.add_argument("--figure", type=int, help="figure number to crop")
    parser.add_argument("--page", type=int, help="render a whole page instead")
    parser.add_argument("--box", help="explicit clip: x0,y0,x1,y1 in PDF points")
    parser.add_argument("--out", required=False, help="output PNG path")
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--list", action="store_true", help="list figure captions as JSON")
    args = parser.parse_args()

    pdf = Path(args.pdf) if args.pdf else download(args.arxiv)
    if not pdf.exists():
        raise SystemExit(f"no such PDF: {pdf}")
    doc = pymupdf.open(pdf)

    if args.list:
        print(json.dumps(captions(doc), indent=2))
        return

    if args.box:
        page_index = (args.page or 1) - 1
        coords = [float(v) for v in args.box.split(",")]
        rect = pymupdf.Rect(*coords)
    elif args.figure:
        page_index, rect = figure_region(doc, args.figure)
    elif args.page:
        page_index = args.page - 1
        rect = doc[page_index].rect
    else:
        raise SystemExit("give --figure N, --page N, --box, or --list")

    if not (0 <= page_index < len(doc)):
        raise SystemExit(f"page {page_index + 1} is outside this {len(doc)}-page PDF")

    out = Path(args.out) if args.out else Path.cwd() / "figure.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    pixmap = doc[page_index].get_pixmap(clip=rect, dpi=args.dpi)
    pixmap.save(out)
    width, height = trim(out)

    caption = ""
    for block in doc[page_index].get_text("blocks"):
        if CAPTION.match(block[4]):
            caption = " ".join(block[4].split())[:200]
            break

    print(
        json.dumps(
            {
                "out": str(out),
                "pdf": str(pdf),
                "page": page_index + 1,
                "dpi": args.dpi,
                "width": width,
                "height": height,
                "caption": caption,
            }
        )
    )


if __name__ == "__main__":
    sys.exit(main())
