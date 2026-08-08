"""Tests for page-selection resolution.

    python3 test_pdf.py     (or: python3 -m pytest test_pdf.py)

The browser parses the same syntax in src/lib/pdf-ocr/pages.ts; these cases
mirror tests/pdf-ocr-pages.test.ts so the two halves cannot drift apart.
"""

from __future__ import annotations

from pdf import PdfError, resolve_pages


def test_blank_selection_means_every_page():
    assert resolve_pages("", 3) == [1, 2, 3]
    assert resolve_pages(None, 2) == [1, 2]
    assert resolve_pages("   ", 2) == [1, 2]


def test_ranges_singles_and_open_ended_tail():
    assert resolve_pages("1-3, 7, 10-", 12) == [1, 2, 3, 7, 10, 11, 12]


def test_overlaps_and_duplicates_count_once():
    assert resolve_pages("3,1-2,2", 5) == [1, 2, 3]
    assert resolve_pages("1-10,3-4", 6) == [1, 2, 3, 4, 5, 6]


def test_selection_is_clamped_to_the_document():
    assert resolve_pages("2-99", 4) == [2, 3, 4]
    assert resolve_pages("1,9", 4) == [1]


def test_empty_segments_are_ignored():
    assert resolve_pages("1,,2,", 4) == [1, 2]


def test_rejects_selections_outside_the_document():
    _expect_error("9-12", 3, "outside")


def test_rejects_malformed_input():
    for bad in ("abc", "1-abc", "-4", "1;2", "1.5"):
        _expect_error(bad, 5, "valid")


def test_rejects_page_zero_since_pages_are_1_based():
    _expect_error("0", 5, "start at 1")
    _expect_error("0-3", 5, "start at 1")


def test_rejects_a_backwards_range():
    _expect_error("9-2", 20, "ends before it starts")


def _expect_error(selection: str, page_count: int, fragment: str) -> None:
    try:
        resolve_pages(selection, page_count)
    except PdfError as exc:
        assert fragment in str(exc), f"{selection!r}: {exc}"
    else:
        raise AssertionError(f"expected {selection!r} to be rejected")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
    print(f"{len(tests)} passed")
