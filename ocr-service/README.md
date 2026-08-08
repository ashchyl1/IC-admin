# OCR service

The PDF-to-text page at `/pdf-ocr` uploads a PDF and gets plain text back. The
reading is done by [Unlimited-OCR](https://github.com/baidu/Unlimited-OCR),
Baidu's extension of DeepSeek-OCR for one-shot long-horizon document parsing.

Unlimited-OCR is a PyTorch vision-language model that wants a CUDA GPU, so it
cannot live inside the Next.js process. It runs here, as a small FastAPI
service, and the app's `/api/pdf-ocr/*` routes proxy to it. Only the Next.js
app needs to reach this service — bind it to localhost.

```
browser ──▶ Next.js /api/pdf-ocr ──▶ this service ──▶ Unlimited-OCR (GPU)
                  (validates,              (renders pages
                   proxies)                 with PyMuPDF, runs the model)
```

## What it does with a PDF

1. Writes the upload to a scratch directory.
2. Resolves the page selection (`1-3,7,10-`) against the real page count.
3. Rasterises each selected page to PNG with PyMuPDF at the requested dpi.
4. Runs the model, in one of two modes:
   - **`page`** — `model.infer(...)` per page with the `document parsing.`
     prompt. Page boundaries survive, and progress is reported as pages land.
   - **`document`** — one `model.infer_multi(...)` over every page with the
     `Multi page parsing.` prompt. This is the long-horizon parse: content that
     straddles a page break reads correctly, at the cost of no progress
     reporting until it finishes.
5. Deletes the page images, keeps the text until the job expires.

OCR of a long PDF takes minutes, so uploads return a job id immediately and the
browser polls. Work runs on a single worker thread: the GPU is the bottleneck,
and two documents at once only makes both slower.

## Running it

### With the model (needs a GPU)

Upstream targets Python 3.12.3 and CUDA 12.9.

```bash
cd ocr-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# then the model dependencies, which are commented out in requirements.txt
pip install torch==2.10.0 torchvision==0.25.0 transformers==4.57.1 \
            tokenizers==0.22.1 Pillow==12.1.1 einops==0.8.2 addict==2.4.0 \
            easydict==1.13 matplotlib==3.10.8 psutil==7.2.2

uvicorn app:app --host 127.0.0.1 --port 8077
```

The weights (~7 GB) download from Hugging Face on first use. Set
`OCR_PRELOAD=1` to load them at startup instead, so no user waits for it.

### Without a GPU (development)

`OCR_BACKEND=embedded-text` swaps the model for PyMuPDF's text-layer
extraction. Every other moving part — upload, page selection, job polling,
progress, downloads — behaves the same, so the web app can be built and tested
on a laptop.

```bash
pip install -r requirements.txt
OCR_BACKEND=embedded-text uvicorn app:app --port 8077
```

It is **not** OCR: it only returns text a PDF already carries, and scanned
pages come back empty. The web page says so while it is in use. Never point
production at it.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OCR_BACKEND` | `unlimited-ocr` | `unlimited-ocr` or `embedded-text` (dev only). |
| `OCR_MODEL_ID` | `baidu/Unlimited-OCR` | Hugging Face model id. |
| `OCR_DEVICE` | `cuda` | Torch device. |
| `OCR_PRELOAD` | off | Load weights at startup rather than on first request. |
| `OCR_RENDER_DPI` | `144` | Default rasterisation dpi; the page can override per job. |
| `OCR_MAX_PAGES` | `200` | Most pages one job may convert. |
| `OCR_MAX_UPLOAD_MB` | `64` | Upload size cap. |
| `OCR_JOB_TTL_MINUTES` | `60` | How long a finished job's text stays retrievable. |
| `OCR_MAX_LENGTH` | `32768` | Generation cap, per the upstream README. |
| `OCR_BASE_SIZE` / `OCR_IMAGE_SIZE` | `1024` / `640` | Gundam crop config for per-page parsing. |
| `OCR_DOCUMENT_IMAGE_SIZE` | `1024` | Image size for whole-document parsing. |
| `OCR_ALLOWED_ORIGINS` | none | Only needed if a browser calls this service directly. |

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Backend, device, whether weights are loaded, limits, queue depth. |
| POST | `/jobs` | Multipart `file`, `mode`, `pages`, `dpi`. Returns `202` and the job. |
| GET | `/jobs/{id}` | Status, progress, per-page text, combined text. |
| POST | `/jobs/{id}/cancel` | Stop between pages. A whole-document parse runs to completion. |
| DELETE | `/jobs/{id}` | Forget the job and its scratch files. |

## Tests

```bash
python3 test_pdf.py     # page-selection resolution
```

The browser validates the same page-selection syntax in
`src/lib/pdf-ocr/pages.ts`, so typos surface before a large upload. The cases in
`test_pdf.py` and `tests/pdf-ocr-pages.test.ts` mirror each other deliberately;
change one and change the other.
