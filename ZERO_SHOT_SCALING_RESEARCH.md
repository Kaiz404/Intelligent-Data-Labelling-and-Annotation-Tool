# Deep Research: Scaling Zero-Shot (Open-Vocabulary) AI Annotation Cheaply

**Prepared:** 25 September 2026  
**Project:** Data Annotation Tool  
**Scope:** How to move AI Annotate beyond "one synchronous Roboflow call per image" to bulk and parallel auto-labelling, while keeping per-project arbitrary text labels, private images, and a near-zero budget. This document builds on [`AI_AUTO_LABELING_RESEARCH.md`](AI_AUTO_LABELING_RESEARCH.md), which covers fixed-class fine-tuned detectors, and [`ROBOFLOW_HOSTED_IMPLEMENTATION_PLAN.md`](ROBOFLOW_HOSTED_IMPLEMENTATION_PLAN.md), which covers job tables, review flow and route contracts. Neither is repeated here.

**Pricing note:** All prices were checked on 25 September 2026 and are in USD unless stated. Figures marked **(est.)** are this document's own arithmetic or assumptions, not vendor-published numbers.

---

## Executive summary

**Short answer:** yes. A self-hosted open-vocabulary detector on scale-to-zero GPU compute (or even a CPU VPS for the smallest models) can do bulk annotation faster, in parallel, and more cheaply per image than the Roboflow free tier. But the first bottleneck to fix is the **architecture, not the credits**.

### Key finding: the credit bottleneck is smaller than the earlier plan assumed

`ROBOFLOW_HOSTED_IMPLEMENTATION_PLAN.md` assumed that serverless calls bill by execution time (500 s per credit). Roboflow's current pricing now bills most models **per image**:

- **YOLO-World:** 0.1875 credits per 1,000 images.
- **Grounding DINO and OWLv2:** 0.75 credits per 1,000 images.
- **SAM 3:** 0.5 credits per 1,000 images.
- A Workflow run bills each model step at that model's rate; the workflow logic itself is not billed per image.
- Sources: [model pricing](https://docs.roboflow.com/deployment/roboflow-cloud/serverless-api/model-pricing), [billing overview](https://docs.roboflow.com/deployment/roboflow-cloud/serverless-api/pricing).

The free Public plan's **15 credits per month** ([pricing](https://roboflow.com/pricing)) therefore cover about **80,000 YOLO-World images per month** (est., 15 ÷ 0.1875 × 1,000). Credits are not what stops "parallel or large-scale" labelling today. What stops it is:

1. The route is synchronous, handles one image per HTTP request, and runs inside Next.js with a 30 s timeout.
2. There is no durable job queue.
3. The hosted API throttles. A legacy doc cited 20 requests/s; current docs publish no figure.
4. The shared pool is still one pool for all users. Heavier models and vision-language models (VLMs, billed by time) drain it much faster.

### Recommendation: queue plus self-hosted Roboflow Inference on scale-to-zero GPU

Build a durable job queue and worker, and keep the existing Roboflow Workflow request shape behind a provider seam.

**Step A (zero cost, days of work).** Add the queue and a worker that fans out to the **hosted** Roboflow workflow with bounded concurrency and retries. This alone gives bulk labelling of tens of thousands of images per month on the free tier.

**Step B (near-zero cost).** Run Roboflow's open-source **`inference` server** (Apache-2.0 core) on **Modal**, with per-second GPU billing, scale-to-zero and **$30 per month of free compute** ([Modal pricing](https://modal.com/pricing)).

- Self-hosted inference **uses no Roboflow credits** ([Roboflow credits docs](https://docs.roboflow.com/platform/billing-and-plans/credits)).
- It exposes the **same `POST /{workspace}/workflows/{id}` endpoint** the current `lib/roboflow/client.ts` already calls ([server source](https://github.com/roboflow/inference/blob/main/inference/core/interfaces/http/http_api.py)). Migration is therefore mostly a base-URL change.
- **Throughput (est.):** YOLO-World-L on one T4 can process 10,000 images in roughly 10–20 minutes.
- **Cost (est.):** well under $1 per 10,000 images, so it is normally covered by Modal's free credit.

### Runner-up: a dedicated Python worker running Ultralytics YOLOE-26

Use this if higher zero-shot accuracy or maximum speed matters.

- YOLOE's text-prompt re-parameterisation has **"zero inference and transferring overhead"**. YOLOE-26x reaches 40.6 LVIS minival mAP ([YOLOE docs](https://docs.ultralytics.com/models/yoloe/), [THU-MIG repo](https://github.com/THU-MIG/yoloe)).
- **Cost of choosing it:**
  - It is AGPL-3.0.
  - Roboflow Inference does not support it, so a small custom worker must replace the base-URL switch.
- **Also worth offering:** SAM 3 as an optional "high-accuracy" mode (LVIS box AP 48.5, commercial-use SAM License), running on the same GPU worker ([SAM 3 paper](https://arxiv.org/html/2511.16719v2), [licence](https://github.com/facebookresearch/sam3/blob/main/LICENSE)).

### Where each other option lands

- **CPU VPS.** Only the YOLO-class models are realistic on CPU. A €6–21 per month Hetzner ARM box, or Oracle Always Free, could run re-parameterised YOLO-World-S or YOLOE-S at roughly 3–7 images/s (est.). Grounding DINO, OWLv2 and SAM 3 need a GPU.
- **Hosted LLM/VLM APIs.** Gemini, Qwen3-VL and Moondream are cheap (about $0.2–1 per 1,000 images, est.) and truly open-vocabulary. However:
  - They return **no confidence scores**, so the existing confidence slider stops working.
  - Their free tiers may use data for training. Gemini's free tier does ([terms](https://ai.google.dev/gemini-api/docs/terms)).
  - They are a reasonable fallback provider, not the primary engine.
- **AWS Rekognition, Google Cloud Vision, Azure AI Vision.** These use a **fixed label taxonomy** and cannot take arbitrary text prompts, so they do not fit this problem.

---

## 1. Roboflow itself

### 1.1 Current plans and limits (checked 25 September 2026)

| Item | Public (free) | Core | Source |
|---|---|---|---|
| Price | $0 | $99/month, or $79/month billed annually | [pricing](https://roboflow.com/pricing) |
| Credits | 15/month | 30/month (monthly billing) or 50/month (annual billing), per the pricing page | [pricing](https://roboflow.com/pricing) |
| Extra credits | Pricing page says "Starting at $4" per credit; a second fetch showed $6 | same | [pricing](https://roboflow.com/pricing) |
| Data/model visibility | "Data and models are open source on Roboflow Universe" | Private | [pricing](https://roboflow.com/pricing) |
| Workflows and hosted API | Yes | Yes | [pricing](https://roboflow.com/pricing) |
| Self-host with Inference | Listed | Listed, plus the "Inference model license" for commercial self-hosting | [pricing](https://roboflow.com/pricing) |
| Batch Processing | Pricing page ticks it for all plans | Same | Conflicts with the [batch guide](https://docs.roboflow.com/deployment/roboflow-cloud/batch-processing) ("Growth and Enterprise") |
| Scoped API keys | No | No (Enterprise) | [scoped keys](https://docs.roboflow.com/developer/authentication/scoped-api-keys) |
| Overage | Credits docs say overage billing is on by default, with a $100/month default cap; the doc does not say whether the free plan hard-stops | | [credits docs](https://docs.roboflow.com/platform/billing-and-plans/credits) |

The Growth plan no longer appears on the pricing page. The batch guide still refers to it, so batch availability on Public/Core is **unresolved**; test it in the dashboard before relying on it.

### 1.2 Per-call cost of zero-shot models on the hosted API

The table below uses published credit rates. The dollar columns are estimates (est.) at $4–6 per credit.

| Workflow model step | Credits / 1,000 images | Images covered by the 15 free credits (est.) | $ / 1,000 images if paid (est.) |
|---|---:|---:|---:|
| YOLO-World (all 8 sizes) | 0.1875 | ~80,000 | $0.75–1.13 |
| SAM 3 (text-prompted) | 0.5 | ~30,000 | $2.00–3.00 |
| Grounding DINO | 0.75 | ~20,000 | $3.00–4.50 |
| OWLv2 | 0.75 | ~20,000 | $3.00–4.50 |
| VLMs (Florence-2, Qwen-VL, Moondream) and custom Python blocks | 500 execution-seconds per credit (0.002 credits/s) | Depends on latency | est. ~$0.8–1.2 per 100 s of execution |

Sources: [model pricing](https://docs.roboflow.com/deployment/roboflow-cloud/serverless-api/model-pricing) and [billing overview](https://docs.roboflow.com/deployment/roboflow-cloud/serverless-api/pricing).

- Failed calls returning 402, 408, 409, 423, 429 or any 5xx use no credits. Calls returning 401, 403 or 404 still do.
- Volume discounts start at 250,000 images per month.
- The [supported-models page](https://docs.roboflow.com/models/supported-models) says Grounding DINO and OWLv2 are *not* available on the hosted API, which contradicts the rate table. Only YOLO-World is known to work in the existing workflow.

**Hosted limits that remain:**

- **Rate limits.** Current docs publish none. A legacy page and a [Roboflow blog post](https://blog.roboflow.com/parallel-inference/) cite about 20 requests/s. **Unverified for the current API.**
- **Cold starts.** "The first request to a model that isn't already loaded incurs a warmup of several seconds" ([choosing a deployment](https://docs.roboflow.com/deployment/choosing-a-deployment)).
- **Privacy.** No Roboflow dataset is created, but images still reach Roboflow's servers by signed URL. This research did not find a published retention statement for inference-only images on the free plan (**unverified**).

### 1.3 Self-hosting Roboflow `inference` (key migration path)

| Question | Answer | Source |
|---|---|---|
| Licence of the server | Core is Apache-2.0. `inference/enterprise` needs an Enterprise contract for production. Each model keeps its upstream licence. | [inference README](https://github.com/roboflow/inference), [supported models](https://docs.roboflow.com/models/supported-models) |
| Credits consumed? | **No.** "Self-hosted inference does not use credits." | [credits docs](https://docs.roboflow.com/platform/billing-and-plans/credits), [self-hosted docs](https://docs.roboflow.com/deployment/self-hosted/self-hosted) |
| API key needed? | Not for foundation models or inline workflow specs. It is needed to fetch a *saved* workflow definition, which is cached for 900 s by default. | [http_api.py](https://github.com/roboflow/inference/blob/main/inference/core/interfaces/http/http_api.py), [env.py](https://github.com/roboflow/inference/blob/main/inference/core/env.py) |
| Same endpoint as today? | **Yes.** `POST /{workspace_name}/workflows/{workflow_id}` exists on the self-hosted server. `POST /workflows/run` accepts the workflow specification inline, so no platform call is needed. | [http_api.py](https://github.com/roboflow/inference/blob/main/inference/core/interfaces/http/http_api.py), [deploy a workflow](https://docs.roboflow.com/workflows/deploy/deploy-a-workflow) |
| Direct model routes | `/yolo_world/infer`, `/grounding_dino/infer`, `/owlv2/infer`, `/sam3/concept_segment` | [http_api.py](https://github.com/roboflow/inference/blob/main/inference/core/interfaces/http/http_api.py) |
| Zero-shot models supported | YOLO-World, SAM 3, OWLv2 and Grounding DINO, plus Florence-2, Qwen2.5-VL/Qwen3-VL, Moondream2 and others. **YOLOE is not listed.** | [supported models](https://docs.roboflow.com/models/supported-models) |
| YOLO-World implementation | Wraps Ultralytics `YOLO` (pinned `>=8.1.44,<=8.3.40`) and caches each class name's CLIP text embedding. The folder ships a GPL-3.0 licence. | [yolo_world.py](https://github.com/roboflow/inference/blob/main/inference/models/yolo_world/yolo_world.py) |
| Commercial self-hosting | The pricing page says a commercial self-hosted "Inference model license" comes with Core/Enterprise. A PR merged 2026-09-24 says it is an Enterprise add-on. **Conflicting.** | [pricing](https://roboflow.com/pricing), [licensing](https://roboflow.com/licensing), [PR #3047](https://github.com/roboflow/inference/pull/3047) |
| Install | `pip install inference-cli && inference server start` picks the CPU or CUDA container automatically. Latest release is v1.6.2 (2026-09-18). | [inference README](https://github.com/roboflow/inference) |

**What this means for the migration:**

- The lowest-effort move is to run the `roboflow/roboflow-inference-server-gpu` container on a GPU host and point `ROBOFLOW_API_URL` at it. Nothing else in `lib/roboflow/client.ts` or the route has to change.
- To avoid any dependency on the Roboflow platform, switch the call to `/workflows/run` with the `gateway-zero-shot-detect` specification exported as JSON. The response still contains `outputs[0].predictions`, which the existing parser handles.
- **Licence:** for a non-commercial university project this carries only GPL-3.0 (YOLO-World) and AGPL-3.0 (Ultralytics) obligations. Before any commercial use, resolve the licence conflict above.

---

## 2. Hosted zero-shot / open-vocabulary detection APIs

**Estimate assumptions** (for the cost column):

- One image per request, about 100 prompt tokens and about 300 output tokens.
- Thinking tokens are excluded.
- Gemini 3 images default to 1,120 tokens ([media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)).

| Provider / model | Arbitrary text → boxes? | Confidence scores? | Price (sourced) | Free tier | Batch | Privacy note | $ / 1,000 images (est.) |
|---|---|---|---|---|---|---|---|
| **Roboflow hosted YOLO-World** (current) | Yes | Yes | 0.1875 credits/1k ([rates](https://docs.roboflow.com/deployment/roboflow-cloud/serverless-api/model-pricing)) | 15 credits/month (~80k images) | Batch plan availability unclear | Images fetched by URL; retention unverified | $0 within free credits; $0.75–1.13 paid |
| **Google Gemini 3.1 Flash-Lite** | Yes: `box_2d` `[ymin,xmin,ymax,xmax]` on a 0–1000 scale ([docs](https://ai.google.dev/gemini-api/docs/image-understanding)) | **No** | $0.25 in / $1.50 out per 1M tokens; Batch 50% off ([pricing](https://ai.google.dev/gemini-api/docs/pricing)) | Yes, but **free-tier content is used to improve Google products and may be read by human reviewers** ([terms](https://ai.google.dev/gemini-api/docs/terms)) | [Batch API](https://ai.google.dev/gemini-api/docs/batch-api), 24 h target | Paid tier is not used for training | ~$0.76; ~$0.38 batch |
| Gemini 3.7/3.8 Flash | Yes | No | $0.75 / $3.75 per 1M tokens | Yes (same caveat) | Yes | same | ~$2.04; ~$1.02 batch |
| **Qwen3-VL via Alibaba Model Studio** | Yes: relative 0–1000 boxes ([docs](https://www.alibabacloud.com/help/en/model-studio/vision)) | No | qwen3-vl-flash $0.05 / $0.40 per 1M tokens ([pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)) | 1M tokens per model (Singapore region) | No VL batch discount listed | Data-use terms not checked | ~$0.19 |
| **Moondream Cloud** `/detect` | Yes, but **one object type per call** ([docs](https://docs.moondream.ai/skills/detect/)) | No | $0.30 / $1.00 per 1M tokens; batch $0.15 / $0.50 ([pricing](https://moondream.ai/pricing)) | $5/month credit | Yes | not checked | ~$0.28 **per label** (5 labels ≈ $1.40) |
| **Replicate** `adirik/grounding-dino` | Yes | Yes | L40S ≈ $0.00098/run ([model](https://replicate.com/adirik/grounding-dino), [pricing](https://replicate.com/pricing)) | None listed | No native batch | Community model, may go stale | ~$0.98 |
| Replicate `florence-2-large` | Yes (phrase grounding) | No native scores | ≈ $0.00098/run ([model](https://replicate.com/lucataco/florence-2-large)) | None | No | same | ~$0.98 |
| **fal.ai** Florence-2 open-vocabulary detection | Yes ([model](https://fal.ai/models/fal-ai/florence-2-large/open-vocabulary-detection)) | No | Page shows "$0 per compute second" (**likely a display error, unverified**) | — | — | — | unknown |
| **HF Inference Endpoints** (host OWLv2/Grounding DINO yourself) | Yes | Yes | T4 $0.50/h, L4 $0.80/h, billed per minute ([pricing](https://huggingface.co/docs/inference-endpoints/pricing)) | No | Your own code | Scale to zero after 15 min idle; **returns 502 while waking, with no queue** ([autoscaling](https://huggingface.co/docs/inference-endpoints/autoscaling)) | ~$0.05 warm (see §5) |
| **DINO-X / Grounding DINO 1.6 Pro** (DeepDataSpace) | Yes; best published zero-shot accuracy (DINO-X Pro 56.0 COCO AP, 59.8 LVIS-minival AP) ([README](https://github.com/IDEA-Research/DINO-X-API)) | Yes | **Pricing page unreadable; unverified** ([price docs](https://cloud.deepdataspace.com/en/docs?hash=%2Fprice%2FREADME)) | Apply for a token | — | China-based provider; payment via the platform | unknown |
| Landing AI Agentic Object Detection | The product page now shows only document APIs ([page](https://landing.ai/agentic-object-detection)) | — | — | — | — | — | Treat as unavailable (unverified) |
| **Amazon Nova 2 (Bedrock)** | Yes: `[x1,y1,x2,y2]` on 0–1000 ([Nova 2 prompting](https://docs.aws.amazon.com/nova/latest/nova2-userguide/prompting-multimodal.html)) | No | Bedrock token pricing not retrieved | No | Bedrock batch | Stays inside AWS next to the S3 bucket | unknown |
| AWS Rekognition DetectLabels | **No**: fixed taxonomy ([labels](https://docs.aws.amazon.com/rekognition/latest/dg/labels.html)); Custom Labels needs training | Yes | $0.001/image ([pricing](https://aws.amazon.com/rekognition/pricing/)) | 1,000/month for 12 months | — | — | Not applicable |
| Google Cloud Vision object localisation | **No**: fixed taxonomy | Yes | $2.25/1k after 1,000 free ([pricing](https://cloud.google.com/vision/pricing)) | 1,000/month | — | — | Not applicable |
| Azure AI Vision 4.0 Objects | **No**: fixed taxonomy; misses objects under about 5% of the image ([docs](https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/concept-object-detection-40)) | Yes | not checked | — | — | — | Not applicable |
| OpenAI GPT vision | Weak: "struggles with tasks requiring precise spatial localization" ([guide](https://developers.openai.com/api/docs/guides/images-vision)) | No | — | — | — | — | Not recommended |

**Takeaways:**

- The VLM APIs are cheap and genuinely open-vocabulary. Their outputs lack confidence scores and their box accuracy is not benchmarked on LVIS/COCO, so they suit a secondary provider or a "describe then detect" fallback.
- Gemini's free tier is unsuitable for private user images.

---

## 3. Open-source, self-hostable open-vocabulary detectors

| Model | Licence (weights/code) | Zero-shot accuracy (as published) | Speed (as published, with hardware) | Shared-vocab batching / caching | CPU viable? | Export | Serving |
|---|---|---|---|---|---|---|---|
| **YOLO-World v1/v2/v2.1** (Tencent AILab) | **GPL-3.0**; README says commercial licensing is available on request ([repo](https://github.com/AILab-CVC/YOLO-World)). Ultralytics port is AGPL-3.0 or Enterprise ([licence](https://www.ultralytics.com/license)) | Paper: L 35.4 LVIS minival AP. v2.1 README (different protocol, AP/APr): S 18.5/12.6 … X 28.6/22.0 | **V100, no TensorRT: L 52.0 FPS re-parameterised vs 17.6 FPS with the text encoder; S 74.1 vs 19.9** ([paper Table 2](https://arxiv.org/html/2401.17270)) | Yes: vocabulary re-parameterised into weights | S/M plausible (est.) | ONNX (`--custom-text`); TensorRT via Ultralytics ([deploy](https://github.com/AILab-CVC/YOLO-World/blob/master/docs/deploy.md), [Ultralytics](https://docs.ultralytics.com/models/yolo-world/)) | Ultralytics, **Roboflow Inference**, ONNX Runtime, Triton |
| **YOLOE / YOLOE-26** (THU-MIG, ICCV 2025; Ultralytics) | **AGPL-3.0** ([repo](https://github.com/THU-MIG/yoloe)) | v8-S/M/L LVIS AP 27.9/32.6/35.9 (APr 22.3/26.9/33.2). YOLOE-26s 30.8, **26x 40.6** LVIS minival mAP ([docs](https://docs.ultralytics.com/models/yoloe/)) | **T4 TensorRT: v8-S 305.8, M 156.7, L 102.5 FPS** ([repo](https://github.com/THU-MIG/yoloe)); v8-S is 1.4× faster than YOLO-Worldv2-S | Yes: RepRTA gives "zero inference and transferring overhead" | S plausible (est.); 64.3 FPS on iPhone 12 CoreML | ONNX, TensorRT, CoreML after `set_classes` | Ultralytics (not Roboflow Inference) |
| **Grounding DINO** (Swin-T/B) | **Apache-2.0**, open weights ([repo](https://github.com/IDEA-Research/GroundingDINO)) | T: 48.4 COCO zero-shot; 27.4 LVIS minival ([paper](https://arxiv.org/abs/2303.05499)) | **T: 1.5 FPS on V100** ([YOLO-World Table 2](https://arxiv.org/html/2401.17270)); **B: 5.7 FPS on A100, PyTorch** ([OmDet-Turbo paper](https://arxiv.org/html/2403.06892)) | Deep text–image fusion, so no re-parameterisation; batching supported | No (est.) | Community ONNX only | HF transformers, Roboflow Inference, NVIDIA TAO |
| Grounding DINO 1.5/1.6 Pro, 1.5 Edge, **DINO-X** | **API only**; no weights (Apache covers only the client code) ([1.5 API](https://github.com/IDEA-Research/Grounding-DINO-1.5-API), [DINO-X API](https://github.com/IDEA-Research/DINO-X-API)) | 1.6 Pro: 55.4 COCO, 57.7 LVIS minival; DINO-X Pro 56.0 COCO / 59.7 LVIS minival | 1.5 Edge: 75.2 FPS with TensorRT (hardware not stated in the abstract) ([paper](https://arxiv.org/abs/2405.10300)) | — | — | — | Hosted only |
| **MM-Grounding-DINO** (OpenMMLab) | Apache-2.0 (inferred from the mmdetection repo) | T/B/L COCO 50.4/52.5/53.0; T: 41.4 LVIS minival AP ([configs](https://github.com/open-mmlab/mmdetection/tree/main/configs/mm_grounding_dino)) | Not published | As Grounding DINO | No (est.) | — | HF transformers |
| **LLMDet** (CVPR 2025) | Apache-2.0 ([repo](https://github.com/iSEE-Laboratory/LLMDet)) | LVIS minival AP: T 44.7, B 48.3, L 51.1 | Not published; Grounding-DINO-based, so likely similar speed (est.) | As Grounding DINO | No (est.) | — | HF transformers ≥ 4.55 |
| **OWLv2 / OWL-ViT** (Google) | **Apache-2.0**, code and checkpoints ([scenic](https://github.com/google-research/scenic/tree/main/scenic/projects/owl_vit)) | LVIS AP/APr: B/16 ST 26.5/29.5; L/14 ST 32.8/34.6. Fine-tuned (+FT) checkpoints are higher but trained on LVIS base classes | Not published. README: with cached text embeddings, speed is "nearly equivalent to standard Vision Transformers" | Text-query embeddings are cacheable per project | No (est.; 960 px ViT input) | — | HF transformers ([docs](https://huggingface.co/docs/transformers/model_doc/owlv2)), Roboflow Inference |
| **OmDet-Turbo** | Apache-2.0 ([repo](https://github.com/om-ai-lab/OmDet)) | Tiny: 42.5 COCO, 30.3 LVIS | **B: 18.6 FPS PyTorch / 100.2 FPS TensorRT on A100**; Tiny 21.5/140 | HF version caches text embeddings and allows **different class lists per image in one batch** ([docs](https://huggingface.co/docs/transformers/model_doc/omdet-turbo)) | Marginal (est.) | ONNX/TensorRT (fixed size; post-processing outside the graph) | HF transformers |
| **SAM 3 / 3.1** (Meta, Nov 2025 / Mar 2026) | **SAM License**: royalty-free commercial use, with military/ITAR and reverse-engineering restrictions ([licence](https://github.com/facebookresearch/sam3/blob/main/LICENSE)); gated on HF | **LVIS box AP 48.5, COCO 56.4**; SA-Co/Gold 54.1 cgF1 ([paper](https://arxiv.org/html/2511.16719v2)) | **30 ms per image with 100+ objects on an H200** | Text prompt → masks and boxes; batched notebook provided ([repo](https://github.com/facebookresearch/sam3)) | No (848M parameters) | — | Roboflow Inference, [Ultralytics](https://docs.ultralytics.com/models/sam-3) |
| **Florence-2** (Microsoft) | MIT ([card](https://huggingface.co/microsoft/Florence-2-large)) | L: 37.5 COCO (`<OD>`); phrase grounding | Not published | No native confidence scores | Possible for the 0.23B model (est.) | — | HF transformers, Roboflow Inference |
| **Moondream 2 / 3** | 2: Apache-2.0 ([repo](https://github.com/vikhyat/moondream)). **3: BSL-1.1**; selling it as a hosted service needs an agreement ([card](https://huggingface.co/moondream/moondream3-preview)) | No LVIS/COCO numbers | Not published; decodes token by token | One label per call | Slow (est.) | — | own runtime, Roboflow Inference (v2) |
| **Qwen3-VL** (2B–235B) | Apache-2.0 ([repo](https://github.com/QwenLM/Qwen3-VL)) | No standard AP; boxes on relative 0–1000 | Not published | vLLM prefix caching only | No | — | vLLM ≥ 0.11, Roboflow Inference |
| Rex-Omni (IDEA, Oct 2025) | IDEA License 1.0 plus Qwen Research licence; commercial use doubtful ([repo](https://github.com/IDEA-Research/Rex-Omni)) | not captured | — | — | — | — | transformers/vLLM |
| RF-DETR | Apache-2.0, but **closed-set only**; no open-vocabulary variant ([repo](https://github.com/roboflow/rf-detr)) | — | — | — | — | — | — |

### 3.1 Prompt-then-detect: why YOLO-World and YOLOE fit per-project labels

**Verified mechanism:**

- YOLO-World's README says it "re-parameterizes vocabulary embeddings as parameters into the model" for a user's vocabulary ([repo](https://github.com/AILab-CVC/YOLO-World)).
- The paper measures the effect: **YOLO-World-L runs at 52.0 FPS re-parameterised vs 17.6 FPS when the text encoder runs per image, on a V100** ([paper Table 2](https://arxiv.org/html/2401.17270)).
- YOLOE's RepRTA folds the text-prompt refinement into the head, so an exported YOLOE with fixed classes "costs nothing per frame" and has the architecture of a plain YOLO ([YOLOE docs](https://docs.ultralytics.com/models/yoloe/)).
- In Ultralytics, `model.set_classes([...])` followed by save/export bakes the vocabulary in. Classes cannot change after export ([YOLO-World docs](https://docs.ultralytics.com/models/yolo-world/)).
- Roboflow Inference's YOLO-World wrapper already caches each class name's CLIP embedding ([yolo_world.py](https://github.com/roboflow/inference/blob/main/inference/models/yolo_world/yolo_world.py)).

**How this maps to this app:**

```text
project_labels (per project) --normalise+sort--> vocab = ["car","person","pallet"]
vocab_hash = sha256(lowercased, sorted names)

worker cache: vocab_hash -> text embeddings (or re-parameterised weights)
  miss: run text encoder once (~tens of ms, est.), store in memory/LRU
  hit : detector runs as a closed-set N-class YOLO

job items are grouped by vocab_hash -> each GPU batch shares one vocabulary
label create/rename/delete -> new vocab_hash -> cache miss on next job
```

Implementation guidance (est.):

- With many small projects, keep **one PyTorch/ONNX model in memory and swap the cached embedding tensor per batch**. Building one TensorRT engine per project costs minutes and would multiply across projects.
- Export a dedicated engine only for a very large project's vocabulary.

**The other families do not collapse the same way:**

- Grounding DINO, MM-Grounding-DINO and LLMDet fuse text inside the encoder and decoder, so text costs something on every image.
- OWLv2 and OmDet-Turbo can cache text embeddings but still run fusion and decoding per image.
- VLMs pay per generated token.

---

## 4. Where to run it cheaply

### 4.1 Scale-to-zero serverless GPU (best fit for bursty usage)

| Provider | GPU price (sourced) | Free credit | Scale-to-zero / cold start | Notes |
|---|---|---|---|---|
| **Modal** | T4 $0.000164/s (≈$0.59/h); L4 $0.000222/s (≈$0.80/h); A10 ≈$1.10/h; plus CPU $0.0000131/core-s and RAM $0.00000222/GiB-s ([pricing](https://modal.com/pricing)) | **$30/month on the Starter plan**; academic credits "up to $10k" | Yes, per-second billing; cold-start time not published | Python-native, easy batch functions; up to 10 concurrent GPUs on Starter |
| **Azure Container Apps serverless GPU** | T4 $0.000073/s East US (≈$0.26/h), **$0.000106/s in Australia East** (≈$0.38/h), plus vCPU/RAM ([docs](https://learn.microsoft.com/en-us/azure/container-apps/gpu-serverless-overview), [retail prices API](https://prices.azure.com/api/retail/prices)) | Monthly free vCPU/GiB-seconds ([pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/)); **Azure for Students $100** ([students](https://azure.microsoft.com/en-us/free/students)) | Yes | **GPU quota requires a support request** for non-EA/PAYG subscriptions; unverified whether student subscriptions qualify |
| **RunPod Serverless (flex)** | 16 GB tier $0.58/h; 24 GB tier (L4/A5000/3090) $0.69/h ([pricing](https://www.runpod.io/pricing)) | not verified | Idle timeout 5 s by default; FlashBoot; you pay for model load ([config](https://docs.runpod.io/serverless/endpoints/endpoint-configurations), [billing](https://docs.runpod.io/serverless/pricing)) | Good container-based fit for the Roboflow Inference image |
| **Google Cloud Run GPU** | L4 $0.0001867/s (≈$0.67/h) without zonal redundancy; needs ≥ 4 vCPU/16 GiB, so ≈ $1.05/h all-in (est.) ([pricing](https://cloud.google.com/run/pricing)) | $300 trial, but **trial accounts cannot use GPUs** ([trial](https://docs.cloud.google.com/free/docs/free-cloud-features)) | Yes; instances "start in approximately 5 seconds" plus model load ([GPU docs](https://docs.cloud.google.com/run/docs/configuring/services/gpu)) | **No Australian region**; nearest is Singapore |
| HF Inference Endpoints | T4 $0.50/h, L4 $0.80/h ([pricing](https://huggingface.co/docs/inference-endpoints/en/pricing)) | — | Scale to zero after 15 min idle; 502 while waking | Needs a client-side retry/queue |
| SageMaker Async Inference | SageMaker instance rates (not fetched) | — | Can scale to zero (`MinCapacity=0`) and queue requests ([docs](https://docs.aws.amazon.com/sagemaker/latest/dg/async-inference-autoscale.html)); multi-minute wake-up (est.) | Stays in AWS. **SageMaker *Serverless* Inference has no GPU** ([docs](https://docs.aws.amazon.com/sagemaker/latest/dg/serverless-endpoints.html)) |
| HF ZeroGPU Spaces | Free (2 Spaces), PRO 10 | 5 min/day of GPU quota for free users, 40 min for PRO ([docs](https://huggingface.co/docs/hub/spaces-zerogpu)) | — | Quota is charged to the *calling* user and the Space must be Gradio; **not usable as a backend worker** |

### 4.2 Always-on / on-demand GPU (only if the worker would be busy most of the time)

| Provider | Price (sourced) | Source |
|---|---|---|
| AWS g4dn.xlarge (T4) | $0.526/h us-east-1; **$0.684/h Sydney**; spot ≈ $0.22 (us-east-1) / $0.26 (Sydney), snapshot | [price feed](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20(N.%20Virginia)/Linux/index.json), [spot feed](https://website.spot.ec2.aws.a2z.com/spot.js) |
| AWS g6.xlarge (L4) | $0.8048/h us-east-1; $1.0464/h Sydney | same |
| AWS g5.xlarge (A10G) | $1.006/h us-east-1; $1.308/h Sydney | same |
| Azure NC4as T4 v3 | $0.684/h Australia East; spot $0.194/h | [retail prices API](https://prices.azure.com/api/retail/prices) |
| RunPod pods | L4 $0.44/h (community); RTX 3090 $0.22/h; A5000 $0.16/h | [pricing](https://www.runpod.io/pricing) |
| Lambda | Cheapest listed: Quadro RTX 6000 $0.69/h | [pricing](https://lambda.ai/pricing) |
| DigitalOcean GPU Droplet | RTX 4000 Ada $0.76/h (5-minute minimum) | [pricing](https://www.digitalocean.com/pricing/gpu-droplets) |
| Vast.ai / SaladCloud | Marketplace or consumer GPUs. Vast's "from $0.10/h" (3090) and Salad's "from $0.015/h" are headline prices only; live rates unverified | [Vast](https://vast.ai/pricing), [Salad](https://salad.com/pricing) |
| GCP Compute Engine T4 / L4 | ≈ $0.35/h T4, ≈ $0.71/h g2-standard-4 (**secondary source, unverified**) | [secondary](https://www.thundercompute.com/blog/google-cloud-gpu-instances) |

### 4.3 CPU VPS: is a zero-shot detector viable on CPU?

| Host | Price (sourced) | Source |
|---|---|---|
| Hetzner CAX11 / CAX21 / CAX31 (ARM) | €5.99 / €10.49 / €20.99 per month, after the June 2026 price rise | [Hetzner price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) |
| DigitalOcean Basic 4 vCPU / 8 GB | $48/month | [pricing](https://www.digitalocean.com/pricing/droplets) |
| Oracle Always Free Ampere A1 | Free: **1,500 OCPU-hours and 9,000 GB-hours per month (≈ 2 OCPU / 12 GB)**. Idle instances can be reclaimed (<20% CPU/network/memory over 7 days) | [Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| AWS c7g.xlarge (Graviton, 4 vCPU) | $0.1887/h Sydney | AWS price feed |

**Viability:**

- Ultralytics publishes CPU ONNX latencies at 640 px of **YOLOv8s 128 ms, v8m 235 ms, v8l 375 ms** per image ([YOLOv8 benchmarks](https://docs.ultralytics.com/models/yolov8/)).
- A re-parameterised YOLO-World-S or YOLOE-S is architecturally a YOLOv8-S-class detector.
- **Estimate:** about 150–300 ms per image on a 4-core x86 VPS, i.e. roughly 12k–25k images/hour. Oracle's 2-OCPU ARM box is probably 2–3× slower.

**Conclusion:**

- A CPU box *can* run YOLO-class zero-shot annotation in the background behind a queue.
- Grounding DINO, OWLv2, SAM 3 and the VLMs are transformer-heavy. At an estimated several seconds per image, they are impractical on CPU.

### 4.4 Student and free programmes

| Programme | What it offers (sourced) | GPU usable? |
|---|---|---|
| Modal Starter / academic | $30/month compute; academic "up to $10k" ([Modal](https://modal.com/pricing)) | **Yes** |
| Azure for Students | $100 credit for 12 months, no card, renewable ([Azure](https://azure.microsoft.com/en-us/free/students)); also listed in the [GitHub Student Pack](https://education.github.com/pack) | Needs quota approval (unverified for students) |
| GitHub Student Developer Pack | Azure $100, Heroku, Appwrite, LocalStack. **The DigitalOcean $200 offer no longer appears** ([pack](https://education.github.com/pack)) | Via Azure |
| AWS Academy Learner Lab | $100 per student in an educator-created class ([guide](https://d1.awsstatic.com/AWS%20Academy%20Learner%20Lab%20Educator%20Guide.pdf)) | Unverified; service list is behind login |
| GCP free trial | $300 for 90 days, **but no GPUs on trial accounts** ([trial](https://docs.cloud.google.com/free/docs/free-cloud-features)) | Only after upgrading |
| Kaggle / Colab | Kaggle about 30 GPU-h/week, 12 h sessions ([Kaggle](https://www.kaggle.com/docs/efficient-gpu-usage)); Colab Pro $9.99 for 100 units ([Colab](https://cloud.google.com/colab/pricing)) | Offline/manual batches only; not a service |

---

## 5. Recommended architecture and migration path

### 5.1 Target shape

```text
Browser ──POST /api/annotations/jobs {projectId, imageIds[], labelIds[], confidence}
           │  (auth + ownership check, same as today's auto-label route)
           ▼
Supabase: annotation_jobs + annotation_job_items rows  ──►  pgmq queue "auto_label"
           │   (one message per image, or per chunk of ≤32 image IDs)
           │
           ├── Next.js route "pokes" the worker (HTTP wake-up)  ─┐
           ▼                                                     ▼
Worker (Modal / RunPod / Azure ACA GPU, or CPU VPS)  ◄── pgmq read(vt=120s, n=32)
   1. group messages by vocab_hash (project + sorted label names)
   2. mint short-lived S3 GET URLs (or read S3 directly with a read-only role)
   3. download + decode in parallel (I/O threads), batch N images per forward pass
   4. detector (provider seam) → canonical boxes (top-left px, labelId, confidence)
   5. write annotation_suggestions + update job_items; pgmq delete/archive
           ▼
Browser polls GET /api/annotations/jobs/{id} or subscribes via Supabase Realtime
Editor loads suggestions into the Konva canvas for review (never overwrites human boxes)
```

**Queue choice:**

- **Supabase Queues (pgmq)** is built into the existing database. It provides "Guaranteed Message Delivery" and "Exactly Once Message Delivery" within a visibility window ([Supabase Queues](https://supabase.com/docs/guides/queues)).
- API: `pgmq_public.send_batch(queue, messages)`, `read(queue, sleep_seconds, n)` (visibility timeout), then `delete`/`archive` ([Queue API](https://supabase.com/docs/guides/queues/api)).
- A plain `annotation_job_items` table claimed with `SELECT … FOR UPDATE SKIP LOCKED` is an equally valid, dependency-free alternative ([PostgreSQL locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)). SQS adds no benefit at this scale.

**Why not Supabase Edge Functions or Next.js for inference:**

- Edge Functions have a 150 s wall-clock limit on Free, **2 s CPU time** and 256 MB memory ([limits](https://supabase.com/docs/guides/functions/limits)). They are fine as a dispatcher, useless for model inference.
- Keep the Next.js route as enqueue-only and return `202 { jobId }`, as already specified in `ROBOFLOW_HOSTED_IMPLEMENTATION_PLAN.md` (Level B).

**Free-plan caveat:** Supabase Free projects pause after one week of inactivity ([pricing](https://supabase.com/pricing)). The worker's polling does not count as a substitute for project activity. Rely on the app's normal traffic, or wake the project before demos.

### 5.2 Provider seam (keep `lib/roboflow/` as one adapter)

Today `detectImage()` in `lib/roboflow/client.ts` is already a deep module: HTTP, auth, timeout and response validation are hidden, and the route converts centre boxes via `fromCenterPixelBox`. Generalise one level up without breaking it:

```ts
// lib/detection/types.ts
export type DetectionInput = { imageId: string; imageUrl: string };
export type Detection = {
  className: string; confidence: number | null;           // null for VLM providers
  box: { x: number; y: number; width: number; height: number }; // top-left px
};
export interface DetectionProvider {
  readonly id: string;                  // "roboflow-hosted" | "roboflow-self" | "yoloe-worker" | "gemini"
  readonly maxBatch: number;            // 1 for per-image HTTP providers
  detect(
    images: DetectionInput[],
    vocab: { classNames: string[]; hash: string },
    opts: { confidence: number; signal?: AbortSignal },
  ): Promise<Map<string, { image: { width: number; height: number }; detections: Detection[] }>>;
}
```

| Adapter | Implementation | Change from today |
|---|---|---|
| `roboflow-hosted` | Existing `detectImage`, looped with p-limit concurrency ≈ 4–8 and retries on 429/5xx (which are not billed) | Wrap only |
| `roboflow-self` | Same client. `ROBOFLOW_API_URL=https://<modal-or-runpod-endpoint>`. Optionally call `/workflows/run` with the exported workflow JSON so no platform key is needed | Base URL, plus an optional inline spec |
| `yoloe-worker` (runner-up) | A Python service owning the batching and the vocab_hash→embedding cache; accepts `{images[], classNames[]}` and returns boxes | New worker; the TS adapter is a thin HTTP client |
| `gemini` / `qwen-vl` (fallback) | Prompt "return JSON boxes for: …", convert 0–1000 `[ymin,xmin,ymax,xmax]` to pixels | New; confidence is `null` |

Select the provider with a server-only env var (for example `DETECTION_PROVIDER`). When this lands, update `AGENTS.md` for the new `lib/detection/` folder, the env vars and the mocked-vs-real row. This research document does not change it.

### 5.3 Migration steps (concrete)

1. **Now, $0: stop being synchronous.**
   - Add the job tables and a `auto_label` pgmq queue.
   - Add `POST /api/annotations/jobs` next to the existing `app/api/annotations/auto-label/route.ts`. Reuse its ownership, label-loading and `labelIdByName` mapping code by moving it into `lib/annotations/auto-label.ts`.
   - Keep the single-image route for the toolbar's instant "AI Annotate this image".
2. **Worker v1 (Node, no GPU).**
   - A tiny long-running process (Modal CPU function, Fly/Render free tier, or the Oracle Always Free VM) reads pgmq, calls the **hosted** workflow with a concurrency of about 4–8, and writes suggestions.
   - Signed URLs come from the existing `createImageReadUrl` in `lib/uploads/s3-server.ts`, minted just before each call.
   - This alone makes 10k-image jobs feasible within the free credits (≈1.9 credits per 10k, sourced rate).
3. **Self-host the same workflow.**
   - Deploy `roboflow-inference-server-gpu` as a Modal/RunPod serverless container with scale-to-zero and switch `ROBOFLOW_API_URL`.
   - The worker can now use larger concurrency, because the rate limit is your own GPU.
   - Verify with the same 20-image smoke set; the boxes should match hosted results closely (same model).
4. **Batch properly (optional, big throughput win).**
   - Replace per-image HTTP with a Python Modal function that takes 16–64 images and one vocabulary, runs Ultralytics YOLO-World-v2 or YOLOE-26 with `set_classes` once per vocab_hash, and returns all results.
   - This is where the re-parameterised speed-up and GPU batching actually pay off.
5. **Quality tier (optional).** Offer SAM 3 (or Grounding DINO/LLMDet) as a slower "high accuracy" provider for hard classes, using the same queue with a different `provider` field on the job.

### 5.4 Throughput and cost estimate for 10,000 images (all figures est.)

**Assumptions** (estimates, not measurements):

- **(a) GPU speed.** A T4 in FP16 PyTorch runs about 0.5–0.7× a V100 for these convolutional/transformer models. An L4 is about 1.5–2× a T4.
- **(b) Overhead.** End-to-end efficiency is about 50%, because S3 download, JPEG decode, resize and DB writes overlap only partly with GPU work.
- **(c) Cost per hour.** A Modal T4 plus 2 vCPU/8 GiB is about $0.75/h all-in (≈ $0.59 GPU + ≈ $0.09 CPU + ≈ $0.06 RAM, from [Modal rates](https://modal.com/pricing)).
- **(d) Cold start.** One cold start per job is about 30–90 s, and is ignored in the totals.

| Model | Sourced speed anchor | Est. end-to-end on T4 | 10k images: wall time (1× T4) | 10k images: Modal cost | Same on L4 |
|---|---|---|---|---|---|
| **YOLO-World-L** (re-parameterised) | 52.0 FPS on V100, no TensorRT ([paper](https://arxiv.org/html/2401.17270)) | ~10–18 img/s | ~10–17 min | **~$0.13–0.21** | ~6–10 min |
| YOLOE-v8-L / YOLOE-26 (TensorRT) | 102.5 FPS on T4 TensorRT ([repo](https://github.com/THU-MIG/yoloe)) | ~20–40 img/s (I/O-bound) | ~4–8 min | ~$0.05–0.10 | ~3–6 min |
| **Grounding DINO-T** | 1.5 FPS on V100 ([YOLO-World Table 2](https://arxiv.org/html/2401.17270)); B = 5.7 FPS on A100 ([OmDet-Turbo](https://arxiv.org/html/2403.06892)) | ~1–2 img/s (FP16 plus batching may reach ~3) | ~1.4–2.8 h | **~$1.00–2.10** | ~0.8–1.6 h |
| **OWLv2 B/16** (cached text) | No official FPS; "nearly equivalent to a standard ViT" | ~2–5 img/s (960 px ViT-B/16; weakest estimate) | ~0.6–1.4 h | **~$0.45–1.05** | ~0.3–0.8 h |
| SAM 3 | 30 ms per image on H200 ([paper](https://arxiv.org/html/2511.16719v2)) | ~2–5 img/s on T4 (large H200→T4 gap; low confidence) | ~0.6–1.4 h | ~$0.45–1.05 | ~0.3–0.8 h |
| *Roboflow hosted YOLO-World (reference)* | 0.1875 credits/1k ([rates](https://docs.roboflow.com/deployment/roboflow-cloud/serverless-api/model-pricing)) | Limited by hosted throttling (~20 req/s legacy, unverified); ~4–8 concurrent × ~1 s ≈ 4–8 img/s | ~20–40 min | 1.875 credits (free within the pool; ≈ $7.50–11 paid) | — |

**What the table implies:**

- Horizontal scaling is trivial: N GPUs means about N× throughput, and Modal Starter allows 10 concurrent GPUs.
- For a YOLO-class model, a single L4/T4 is already I/O-bound. Download, decode and DB writes, not the GPU, become the bottleneck.
- To prevent that, prefetch images with a thread pool and write suggestions in bulk (one insert per batch).

---

## 6. Cost scenarios (images per month, est.)

Assumptions: one inference per image, average project with about 5 labels, and cold-start overhead ignored except where noted.

| Option | 1,000 / month | 10,000 / month | 100,000 / month | Notes |
|---|---:|---:|---:|---|
| Roboflow hosted YOLO-World (status quo + queue) | $0 (0.19 credits) | $0 (1.9 credits) | 18.75 credits > 15 free, so ≈ $15–25 extra credits (if the free plan can buy them) or Core $99 | Shared pool with every other user and model; SAM 3 or Grounding DINO use 2.7–4× more credits |
| **Self-hosted Roboflow Inference, YOLO-World-L, Modal T4** | ~$0.02 + cold starts ≈ $0.05 | ~$0.2–0.3 | ~$2–3 | Inside the $30/month free credit up to roughly 1M+ images/month (est.) |
| Ultralytics YOLOE (TensorRT), Modal T4/L4 | ~$0.01–0.05 | ~$0.1–0.2 | ~$1–2 | AGPL-3.0 |
| Grounding DINO-T, Modal T4 | ~$0.1–0.2 | ~$1–2 | ~$10–21 | Still mostly inside $30 free credit |
| OWLv2 B/16 or SAM 3, Modal T4 | ~$0.05–0.1 | ~$0.5–1 | ~$5–10 | Low-confidence estimate |
| Azure Container Apps T4, Australia East | similar to Modal (≈ $0.38/h GPU + vCPU) | ~$0.2 | ~$2–4 | Paid from Azure for Students $100 if quota is granted |
| CPU VPS (Hetzner CAX21/CAX31), YOLO-World-S/YOLOE-S ONNX | €10.49–20.99 flat | same | same (≈ 4–8 CPU-hours) | Fixed cost; no GPU models; Oracle Always Free = $0 but slower, with reclaim risk |
| AWS g4dn.xlarge Sydney, started per batch | ~$0.7 (1 h minimum) | ~$0.7 | ~$2–4 | Needs start/stop orchestration; always-on = ~$500/month |
| Gemini 3.1 Flash-Lite (paid Batch) | ~$0.38 | ~$3.8 | ~$38 | No confidence scores; free tier unsuitable for private data |
| Qwen3-VL-Flash | ~$0.19 | ~$1.9 | ~$19 | No confidence scores |
| Replicate Grounding DINO | ~$0.98 | ~$9.8 | ~$98 | No setup; community model |

**Bottom line:** at 100k images/month, self-hosting a YOLO-class zero-shot model on scale-to-zero GPU costs a few dollars and fits entirely within Modal's free credit. Hosted Roboflow is free up to about 80k YOLO-World images/month, but that pool is shared across all users and rate-limited.

---

## 7. Risks and caveats

- **Zero-shot accuracy is modest.**
  - Rare-class LVIS AP is about 20–33 for YOLO-World/YOLOE L-size models, versus 45–60 for the best API-only or heavy models (DINO-X, SAM 3).
  - Fine-tuned closed-set detectors remain far better for fixed classes; see `AI_AUTO_LABELING_RESEARCH.md`.
  - Expect prompt sensitivity: "car" vs "sedan" vs "vehicle".
  - Measure correction time on a gold set before claiming a win.
- **Confidence is not comparable across models.**
  - YOLO-World-style scores are often low for valid detections (est., from general experience).
  - Calibrate the default `ROBOFLOW_CONFIDENCE` separately per provider.
  - VLM providers return no scores at all.
- **Licences.**
  - YOLO-World: GPL-3.0. Ultralytics code/weights, including YOLOE: AGPL-3.0, which reaches network use ([Ultralytics licence](https://www.ultralytics.com/license)).
  - SAM 3: custom SAM License with use restrictions. Moondream 3: BSL-1.1. Rex-Omni: non-commercial-leaning.
  - Grounding DINO, OWLv2, OmDet-Turbo, LLMDet and Florence-2: Apache-2.0 or MIT.
  - Roboflow's own statements on the commercial self-hosted licence conflict ([pricing](https://roboflow.com/pricing) vs [PR #3047](https://github.com/roboflow/inference/pull/3047)).
  - Fine for a university project; revisit before any commercial launch.
- **Cold starts.**
  - Serverless GPUs load a container and model weights. Modal and RunPod publish no fixed figure; Cloud Run quotes about 5 s before model load.
  - HF Endpoints return 502 while waking.
  - Batch jobs amortise cold starts; the single-image toolbar button feels them most. Consider keeping hosted Roboflow for single images and self-hosted for bulk.
- **GPU availability and quotas.**
  - Azure serverless GPU needs a support request.
  - GCP trial accounts have no GPUs, and Cloud Run has no Australian GPU region.
  - Spot and marketplace capacity (Vast, Salad) can be pre-empted.
  - Salad and Vast run on third-party consumer hardware, a privacy concern for private images.
- **Data residency and privacy.**
  - Images leave AWS for Modal, RunPod or Azure through signed URLs.
  - Keep URLs short-lived and never log them.
  - Prefer a provider region close to the S3 bucket; Azure Australia East is the only serverless GPU option confirmed in Australia.
- **Documentation inconsistencies at Roboflow.** Batch plan eligibility, hosted availability of Grounding DINO and OWLv2, the credit price ($4 vs $6) and free-plan overage behaviour all conflict between pages. Test in the dashboard before committing.
- **The Oracle Always Free shape is now 2 OCPU / 12 GB**, not the older 4 / 24, and idle instances can be reclaimed.

---

## 8. Sources

**Roboflow**

- [Pricing](https://roboflow.com/pricing), [credits docs](https://docs.roboflow.com/platform/billing-and-plans/credits), [credit units](https://roboflow.com/credits)
- [Serverless billing overview](https://docs.roboflow.com/deployment/roboflow-cloud/serverless-api/pricing), [per-model rates](https://docs.roboflow.com/deployment/roboflow-cloud/serverless-api/model-pricing)
- [Choosing a deployment](https://docs.roboflow.com/deployment/choosing-a-deployment), [Batch Processing guide](https://docs.roboflow.com/deployment/roboflow-cloud/batch-processing), [parallel-inference blog](https://blog.roboflow.com/parallel-inference/)
- [Supported models](https://docs.roboflow.com/models/supported-models), [licensing](https://roboflow.com/licensing), [scoped keys](https://docs.roboflow.com/developer/authentication/scoped-api-keys)
- [Self-hosted deployment](https://docs.roboflow.com/deployment/self-hosted/self-hosted), [deploy a workflow](https://docs.roboflow.com/workflows/deploy/deploy-a-workflow)
- `inference` source: [README](https://github.com/roboflow/inference), [http_api.py](https://github.com/roboflow/inference/blob/main/inference/core/interfaces/http/http_api.py), [env.py](https://github.com/roboflow/inference/blob/main/inference/core/env.py), [yolo_world.py](https://github.com/roboflow/inference/blob/main/inference/models/yolo_world/yolo_world.py), [PR #3047](https://github.com/roboflow/inference/pull/3047)

**Models**

- YOLO-World: [repo](https://github.com/AILab-CVC/YOLO-World), [deploy docs](https://github.com/AILab-CVC/YOLO-World/blob/master/docs/deploy.md), [paper](https://arxiv.org/html/2401.17270), [Ultralytics docs](https://docs.ultralytics.com/models/yolo-world/)
- YOLOE: [repo](https://github.com/THU-MIG/yoloe), [Ultralytics docs](https://docs.ultralytics.com/models/yoloe/)
- Ultralytics: [licence](https://www.ultralytics.com/license), [YOLOv8 benchmarks](https://docs.ultralytics.com/models/yolov8/)
- Grounding DINO: [repo](https://github.com/IDEA-Research/GroundingDINO), [paper](https://arxiv.org/abs/2303.05499)
- Grounding DINO 1.5/1.6 and DINO-X: [1.5 API](https://github.com/IDEA-Research/Grounding-DINO-1.5-API), [1.5 paper](https://arxiv.org/abs/2405.10300), [DINO-X API](https://github.com/IDEA-Research/DINO-X-API), [DeepDataSpace pricing](https://cloud.deepdataspace.com/en/docs?hash=%2Fprice%2FREADME)
- [MM-Grounding-DINO](https://github.com/open-mmlab/mmdetection/tree/main/configs/mm_grounding_dino), [LLMDet](https://github.com/iSEE-Laboratory/LLMDet)
- OWLv2: [scenic](https://github.com/google-research/scenic/tree/main/scenic/projects/owl_vit), [transformers docs](https://huggingface.co/docs/transformers/model_doc/owlv2)
- OmDet-Turbo: [repo](https://github.com/om-ai-lab/OmDet), [paper](https://arxiv.org/html/2403.06892), [transformers docs](https://huggingface.co/docs/transformers/model_doc/omdet-turbo)
- SAM 3: [repo](https://github.com/facebookresearch/sam3), [licence](https://github.com/facebookresearch/sam3/blob/main/LICENSE), [paper](https://arxiv.org/html/2511.16719v2), [Ultralytics docs](https://docs.ultralytics.com/models/sam-3)
- [Florence-2](https://huggingface.co/microsoft/Florence-2-large)
- Moondream: [repo](https://github.com/vikhyat/moondream), [Moondream 3 card](https://huggingface.co/moondream/moondream3-preview)
- [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL), [Rex-Omni](https://github.com/IDEA-Research/Rex-Omni), [RF-DETR](https://github.com/roboflow/rf-detr)

**Hosted APIs**

- Gemini: [image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [media resolution](https://ai.google.dev/gemini-api/docs/media-resolution), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [batch](https://ai.google.dev/gemini-api/docs/batch-api), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [terms](https://ai.google.dev/gemini-api/docs/terms)
- Alibaba Model Studio: [vision](https://www.alibabacloud.com/help/en/model-studio/vision), [pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- Moondream: [detect](https://docs.moondream.ai/skills/detect/), [pricing](https://moondream.ai/pricing), [rate limits](https://docs.moondream.ai/rate-limits/)
- Replicate: [pricing](https://replicate.com/pricing), [grounding-dino](https://replicate.com/adirik/grounding-dino), [florence-2](https://replicate.com/lucataco/florence-2-large)
- [fal.ai Florence-2](https://fal.ai/models/fal-ai/florence-2-large/open-vocabulary-detection), [Landing AI](https://landing.ai/agentic-object-detection)
- AWS: [Nova 2 multimodal prompting](https://docs.aws.amazon.com/nova/latest/nova2-userguide/prompting-multimodal.html), [Rekognition labels](https://docs.aws.amazon.com/rekognition/latest/dg/labels.html), [Rekognition pricing](https://aws.amazon.com/rekognition/pricing/)
- [Google Cloud Vision pricing](https://cloud.google.com/vision/pricing), [Azure object detection 4.0](https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/concept-object-detection-40), [OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision)

**Compute**

- [Modal pricing](https://modal.com/pricing)
- RunPod: [pricing](https://www.runpod.io/pricing), [endpoint config](https://docs.runpod.io/serverless/endpoints/endpoint-configurations), [serverless billing](https://docs.runpod.io/serverless/pricing)
- [Vast.ai](https://vast.ai/pricing), [Lambda](https://lambda.ai/pricing), [SaladCloud](https://salad.com/pricing)
- Hugging Face: [ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu), [Inference Endpoints pricing](https://huggingface.co/docs/inference-endpoints/en/pricing), [autoscaling](https://huggingface.co/docs/inference-endpoints/en/autoscaling), [Inference Providers pricing](https://huggingface.co/docs/inference-providers/pricing)
- [Kaggle GPU](https://www.kaggle.com/docs/efficient-gpu-usage), [Colab pricing](https://cloud.google.com/colab/pricing)
- AWS: [EC2 on-demand price feed](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20(N.%20Virginia)/Linux/index.json), [spot feed](https://website.spot.ec2.aws.a2z.com/spot.js), [SageMaker Serverless](https://docs.aws.amazon.com/sagemaker/latest/dg/serverless-endpoints.html), [SageMaker Async autoscaling](https://docs.aws.amazon.com/sagemaker/latest/dg/async-inference-autoscale.html)
- Google Cloud: [Cloud Run pricing](https://cloud.google.com/run/pricing), [Cloud Run GPU](https://docs.cloud.google.com/run/docs/configuring/services/gpu), [GCP free trial](https://docs.cloud.google.com/free/docs/free-cloud-features)
- Azure: [Container Apps serverless GPU](https://learn.microsoft.com/en-us/azure/container-apps/gpu-serverless-overview), [Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), [Azure retail prices API](https://prices.azure.com/api/retail/prices), [Azure for Students](https://azure.microsoft.com/en-us/free/students)
- [Hetzner price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [DigitalOcean Droplets](https://www.digitalocean.com/pricing/droplets), [DigitalOcean GPU](https://www.digitalocean.com/pricing/gpu-droplets), [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [GitHub Student Developer Pack](https://education.github.com/pack), [AWS Academy Learner Lab guide](https://d1.awsstatic.com/AWS%20Academy%20Learner%20Lab%20Educator%20Guide.pdf)
- Secondary (GCP GPU prices only): [Thunder Compute](https://www.thundercompute.com/blog/google-cloud-gpu-instances)

**Architecture**

- Supabase: [Queues](https://supabase.com/docs/guides/queues), [Queue API](https://supabase.com/docs/guides/queues/api), [Edge Function limits](https://supabase.com/docs/guides/functions/limits), [pricing](https://supabase.com/pricing)
- [PostgreSQL `FOR UPDATE SKIP LOCKED`](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)

## Research notes

- Research depth: broad survey across four areas (Roboflow, hosted APIs, open models, compute), plus architecture synthesis.
- Source preference: official pricing pages and docs, GitHub READMEs, licences and source files, arXiv papers, and HF model cards. One secondary source is flagged (GCP Compute Engine GPU prices).
- **Could not verify from primary sources:**
  - Roboflow: current hosted rate limit; exact extra-credit price; whether Batch Processing works on Public/Core; whether Grounding DINO and OWLv2 run on the hosted API; free-plan overage behaviour; retention of inference-only images; commercial self-host licence tier.
  - Hosted APIs: DeepDataSpace/DINO-X pricing; fal.ai pricing; Landing AI object-detection status; Moondream tokens per image; Bedrock Nova and Azure Vision prices; Gemini free-tier RPM/RPD; Alibaba data-use terms; Qwen2.5-VL per-size licences.
  - Speed: official speeds for OWLv2, LLMDet, MM-Grounding-DINO, Florence-2, Moondream and Qwen-VL; any CPU latency for YOLO-World, YOLOE or OWLv2.
  - Compute: GCP Compute Engine GPU prices; Vast/Salad live rates; RunPod free credits; AWS Academy GPU access; Azure-for-Students GPU quota; Modal and RunPod cold-start times.
- The earlier `ROBOFLOW_HOSTED_IMPLEMENTATION_PLAN.md` statement that serverless calls bill "500 sec/credit per inference call" is **outdated** for YOLO-World and other per-image models. Time-based billing now applies only to VLMs and custom Python blocks.
