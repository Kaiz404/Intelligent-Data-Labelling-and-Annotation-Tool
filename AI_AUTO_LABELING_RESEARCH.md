# Deep Research: Bulk Image Auto-Labeling for Fixed Object Classes

**Prepared:** 10 September 2026  
**Project:** Data Annotation Tool  
**Scope:** Five strong hosted or self-hosted options that accept many images and return class-labelled bounding boxes. The target classes are assumed to be known in advance.

## Executive summary

For fixed classes, the production model should be a fine-tuned closed-set object detector. Open-vocabulary models such as Grounding DINO are valuable for generating an initial set of imperfect boxes, but a smaller detector trained on reviewed project data will normally be faster, cheaper at volume, and more predictable.

The best default for this project is **self-hosted RF-DETR Small or Medium**. Its core models and code are Apache 2.0 licensed, it supports custom COCO/YOLO datasets, true batched prediction, and ONNX/TensorRT export. Its official T4 TensorRT figures show an attractive accuracy/latency range, although those figures must not be treated as this application's end-to-end throughput. **Ultralytics YOLO** is the easiest and most mature alternative and has very small, fast variants, but AGPL-3.0 versus Enterprise licensing must be resolved before embedding it in a proprietary service.

For a quick pilot with minimal infrastructure, **Roboflow Hosted/Batch Processing** is the strongest managed option. It directly supports batch jobs, custom models, webhooks/results export, and a convenient bounding-box JSON response. **NVIDIA TAO + TensorRT/Triton** is compelling when the team wants an NVIDIA-centred training and serving stack, but it is operationally heavier. **Amazon Rekognition Custom Labels** fits the existing S3 architecture and has managed scaling, but its provisioned inference-hour pricing, limited portability, and weaker control over the model make it the fifth choice.

Recommended sequence:

1. Manually verify 200–500 representative images as a gold test set.
2. If too little training data exists, use Grounding DINO once to propose boxes, then review them.
3. Fine-tune **RF-DETR Small/Medium** and **YOLO small/medium** on the same split.
4. Compare accuracy, correction time, throughput, and all-in cost; keep Roboflow Hosted as the low-operations baseline.
5. Put the winner behind an internal provider interface so deployment can change without changing the annotation UI.

## What the system actually needs

The requirement is not merely “upload several images to a model.” A reliable bulk feature needs an asynchronous job system:

```text
private S3 images -> durable job queue -> detector worker/API
                  -> normalized box suggestions -> human review -> accepted annotation
```

The current application already uploads directly to private S3 and stores each image's `object_key`. That is the right handoff point. Long inference and provider polling should not run in a Next.js request. A worker should fetch the object using an AWS role or a just-in-time signed URL, perform inference, and persist versioned suggestions in Supabase.

The current editor stores boxes only in `sessionStorage`, while `images.annotation` merely drives an annotated/unannotated status. Before AI labeling is integrated, the app needs durable annotations and separate states such as `queued`, `running`, `suggested`, `reviewed`, `accepted`, and `failed`.

Use one canonical internal box representation regardless of provider:

```ts
type Detection = {
  id: string;
  labelId: string;       // stable project label ID
  sourceClass: string;   // provider/model class name
  confidence: number;    // 0..1
  bbox: { x: number; y: number; width: number; height: number };
  modelVersion: string;
};
```

Coordinates should be top-left-origin, absolute pixels in the correctly EXIF-oriented original image. Roboflow returns centre-based pixel `x`, `y`, `width`, `height`, so conversion is `left = x - width/2`, `top = y - height/2` ([Roboflow prediction format](https://docs.roboflow.com/workflow-blocks/run-a-model/object-detection-model)). AWS returns `Left`, `Top`, `Width`, and `Height` as fractions of image dimensions, which must be multiplied and clamped ([AWS BoundingBox](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_BoundingBox.html)).

## Weighted decision matrix

Scores are informed priors, not benchmark results for this dataset. Each option still needs the bake-off below. Weights reflect the stated priority on performance and bulk processing while recognising that annotation labour dominates the total cost when predictions are poor.

| Option | Domain accuracy 35% | Human correction reduction 20% | Bulk throughput 15% | All-in cost 15% | Privacy/deployment 10% | Integration/lock-in 5% | Weighted score / 5 |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Self-hosted RF-DETR S/M** | 4.6 | 4.5 | 4.5 | 4.5 | 5.0 | 3.5 | **4.5** |
| **Self-hosted Ultralytics YOLO** | 4.3 | 4.3 | 5.0 | 4.5 | 4.0 | 4.5 | **4.4** |
| **Roboflow Hosted/Batch** | 4.5 | 4.5 | 5.0 | 3.8 | 3.0 | 5.0 | **4.3** |
| **NVIDIA TAO + Triton** | 4.4 | 4.3 | 4.8 | 3.6 | 5.0 | 3.0 | **4.3** |
| **AWS Rekognition Custom Labels** | 4.0 | 4.0 | 4.0 | 3.5 | 4.0 | 4.0 | **3.9** |

### Short interpretation

- Choose **RF-DETR** when permissive licensing, accuracy, model ownership, and low marginal inference cost matter most.
- Choose **YOLO** when developer ergonomics, tiny fast models, and ecosystem maturity matter most—and its licence is acceptable.
- Choose **Roboflow Hosted** when getting a working pilot quickly matters more than maximum control or the lowest long-run cost.
- Choose **NVIDIA TAO** when the team already has NVIDIA GPU/container expertise or needs NVIDIA optimisation and support.
- Choose **AWS Custom Labels** when staying entirely inside AWS and minimising ML engineering matter more than portability.

## Option 1 — Self-hosted RF-DETR Small or Medium

**Why it is first:** RF-DETR is designed for custom closed-set fine-tuning and offers a strong accuracy/latency trade-off without the commercial licensing ambiguity of Ultralytics' AGPL models. The project supports COCO JSON and YOLO datasets, accepts lists of images for batched prediction, and exports to ONNX, TensorRT, and TFLite. Core Nano through Large models and the training/inference code are Apache 2.0; XLarge and 2XLarge use a separate platform model licence, so the core sizes are the safer starting point ([official RF-DETR documentation](https://rfdetr.roboflow.com/latest/), [official repository](https://github.com/roboflow/rf-detr)).

Published T4 TensorRT FP16, batch-one figures range from 48.4 COCO AP at 2.3 ms for Nano to 56.5 AP at 6.8 ms for Large. Small and Medium sit in the useful middle. These are model-only vendor benchmarks on COCO, not S3-to-database job throughput and not evidence of accuracy on this project's classes ([RF-DETR benchmarks and requirements](https://github.com/roboflow/rf-detr/blob/develop/docs/index.md), [RF-DETR paper](https://arxiv.org/abs/2511.09554)).

**Strengths**

- Apache 2.0 core models are suitable for an open or proprietary application.
- Strong vendor-reported accuracy and domain-transfer behaviour.
- Real batched inference; output includes pixel `xyxy`, confidence, and class ID/name.
- ONNX/TensorRT export supports an S3-adjacent Python worker and later optimisation.
- No per-image software fee when self-hosted.

**Weaknesses**

- Younger and less widely deployed than the YOLO ecosystem.
- Nano is materially larger than the smallest YOLO variants.
- Fine-tuning wants a CUDA GPU; official guidance recommends roughly 8 GB VRAM, although smaller variants can use less with reduced batches.
- Infrastructure, autoscaling, monitoring, and model lifecycle remain the team's responsibility.

**Best fit here:** default bake-off candidate. Start with Small and Medium rather than choosing Large from a COCO headline.

## Option 2 — Self-hosted Ultralytics YOLO

**Why it is strong:** Ultralytics has the smoothest training/inference experience and excellent bulk ergonomics. Predict mode accepts directories, globs, CSV files, lists, and tensors; `batch` increases throughput and `stream=True` yields results without retaining an entire large dataset in memory ([Ultralytics predict mode](https://docs.ultralytics.com/modes/predict)). Results expose pixel and normalised boxes, class IDs, and confidence, making the adapter simple.

The current YOLO26 family reports 40.9–57.5 COCO mAP50–95 and 1.7–11.8 ms T4 TensorRT latency across its Nano-to-XLarge detector sizes. It exports to TensorRT, ONNX, OpenVINO, CoreML, and other formats ([YOLO26 model card and benchmark](https://docs.ultralytics.com/models/yolo26)). Again, use these only to choose candidates for a local benchmark.

**Strengths**

- Best-in-class developer ergonomics and broad deployment ecosystem.
- Very small models and excellent throughput options.
- Straightforward batching and result serialisation.
- Easy fine-tuning for fixed project classes.
- Free software use when AGPL obligations are acceptable.

**Weaknesses**

- Ultralytics states that embedding its code/models in a proprietary product without following AGPL constraints requires an Enterprise licence ([Ultralytics licensing](https://www.ultralytics.com/license)). This is a gating legal/product decision, not a minor detail.
- COCO-pretrained weights only know their trained vocabulary; custom classes require training.
- The easiest library path can create vendor-specific coupling unless the model is exported behind a generic runtime.

**Best fit here:** simplest POC and likely throughput leader. If the project remains educational/open-source, the licensing issue may be easy; if it becomes closed-source SaaS, obtain legal guidance or an Enterprise quote.

## Option 3 — Roboflow Hosted API and Batch Processing

**Why it is strong:** Roboflow offers the shortest route from data upload and labeling to training, batch inference, and exported results. Its batch API supports staged image data, asynchronous jobs, status/progress inspection, result export, and webhooks. The hosted prediction format includes image dimensions, class, confidence, and centre-based pixel boxes ([Roboflow batch API](https://docs.roboflow.com/roboflow/roboflow-jp/depuroi/batch-processing/api-reference), [prediction JSON](https://docs.roboflow.com/workflow-blocks/run-a-model/object-detection-model)).

The current Public plan is free but makes datasets and models public. Private work starts with Core, listed at US$79/month billed annually or US$99 monthly ([Roboflow plans](https://roboflow.com/pricing)). Credits cover uploads, storage, AI labeling, training, and deployment. Current published units include 10,000 uploaded images, 5,000 stored images per month, or 1,000 AI-labeled images per credit ([credit units](https://roboflow.com/credits)). Roboflow's detailed current Batch Processing guide states that native batch jobs require Growth or Enterprise, despite inconsistent naming/feature presentation elsewhere. The free-tier pilot should therefore use controlled per-image Serverless API calls rather than assume access to native Batch Processing ([current batch guide](https://docs.roboflow.com/deployment/roboflow-cloud/batch-processing)).

Roboflow's batch pricing examples for 100,000 images list approximately 0.04 credits per 1,000 images for YOLOv8 Nano at 640 px, 0.06 for Medium, and 0.08 for Large; higher resolution costs more ([batch pricing](https://docs.roboflow.com/deploy/batch-processing/batch-processing-pricing)). Those inference figures do not include every possible storage, upload, training, workflow, or subscription cost, and pricing can change.

**Strengths**

- Fastest path to a convincing end-to-end feature.
- Genuine asynchronous batch workflow rather than client-side request loops.
- Training, dataset management, active learning, model hosting, and annotation tooling in one product.
- Can deploy Roboflow models such as RF-DETR or supported YOLO variants.
- Little infrastructure work for the team.

**Weaknesses**

- Free projects are public, unsuitable for private user data.
- The Serverless API documents a 20 MB input limit; oversized images need preprocessing or a different ingestion route.
- Subscription/credit accounting has several cost dimensions and should be tested with a real workload.
- Images may leave the current AWS environment; privacy, retention, deletion, region, and egress must be reviewed.
- Highest platform lock-in of the leading options unless weights are exportable under the chosen plan/model licence.

**Best fit here:** managed baseline and fastest pilot. It may remain the winner at modest volume where engineering time costs more than inference.

## Option 4 — NVIDIA TAO plus TensorRT/Triton

**Why it is strong:** TAO covers the complete NVIDIA-oriented path: auto-labeling, fine-tuning detectors, ONNX export, quantisation, TensorRT optimisation, and serving. Its current model family includes DINO, D-DETR, Grounding DINO, RT-DETR, and EfficientDet ([TAO overview](https://docs.nvidia.com/tao/tao-toolkit/latest/text/overview.html)). NVIDIA says TAO is free to download and its terms permit commercial training and deployment, although each pretrained model/container licence still needs checking ([NVIDIA TAO product page](https://developer.nvidia.com/tao-toolkit)).

For the cold start, TAO's Grounding DINO auto-label pipeline reads image directories, accepts known class names, and exposes `batch_size`, workers, GPU IDs, confidence schedules, and NMS/DBSCAN aggregation ([TAO Grounding DINO auto-labeling](https://docs.nvidia.com/tao/tao-toolkit/latest/text/data_services/auto-label/grounding_dino.html)). For steady-state fixed-class serving, use a fine-tuned compact detector rather than repeatedly running Grounding DINO.

Triton's dynamic batcher combines independent detection requests to improve GPU utilisation and supports multiple model instances. NVIDIA explicitly recommends measuring latency and throughput with its performance tools because the best batching/instance settings are model-specific ([Triton dynamic batching](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/batcher.html)).

**Strengths**

- Excellent batch serving and GPU utilisation controls.
- Strong training, quantisation, export, and deployment toolchain.
- Can keep images in the team's infrastructure.
- Commercial use is supported under NVIDIA's terms; much TAO source is Apache 2.0.
- Good route to high-volume or edge NVIDIA deployment.

**Weaknesses**

- Considerably more operational complexity than a simple Python RF-DETR/YOLO worker.
- NVIDIA/CUDA-centred and therefore less portable.
- “TAO” is a toolkit, not a single accuracy result; the chosen detector still determines quality.
- DeepStream is mainly valuable for live video, not necessary for this static-image workload.

**Best fit here:** choose when NVIDIA optimisation/support is an explicit platform decision, not merely because NVIDIA is a familiar name.

## Option 5 — Amazon Rekognition Custom Labels

**Why it is viable:** Custom Labels trains a managed detector for business-specific objects, reads directly from S3, and returns class, confidence, and normalised bounding boxes. This matches the existing storage layer with minimal data movement ([DetectCustomLabels API](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectCustomLabels.html), [output example](https://docs.aws.amazon.com/rekognition/latest/customlabels-dg/detecting-custom-labels.html)). The default data-plane quota is currently 50 `DetectCustomLabels` transactions per second, with at most five inference units per started model and 250,000 images per dataset; quota increases can be requested ([AWS Rekognition quotas](https://docs.aws.amazon.com/general/latest/gr/rekognition.html)).

The pricing model is less attractive for sporadic traffic unless the application explicitly starts the model, drains a queue, and stops it. AWS lists US$1 per billed training hour and US$4 per inference-unit hour in its examples. AWS advises provisioning only for scheduled batches and stopping afterward; idle started models continue billing. Its example estimates 440,000 images in 44 inference hours, but actual throughput depends on image size and model complexity ([AWS pricing](https://aws.amazon.com/rekognition/pricing/)).

**Strengths**

- Natural fit with the existing private S3 bucket and IAM.
- Managed training, serving, scaling, and security controls.
- No cross-cloud image transfer when deployed in a supported matching AWS region.
- Predictable API shape and confidence threshold.

**Weaknesses**

- Provisioned inference-hour billing creates idle-cost and start/stop orchestration concerns.
- Custom model weights are not portable like ONNX/TensorRT artifacts.
- Less control over architecture, optimisation, and debugging.
- Maximum running models and inference units can constrain multi-tenant scale.

**Best fit here:** AWS-native low-ML-operations fallback, especially if workload batches are predictable and the team values managed service more than model ownership.

### Hosted alternative not shortlisted — Google Vertex AI AutoML

Vertex AI AutoML Image Object Detection is a credible managed alternative with true asynchronous batch prediction: a JSONL manifest in Cloud Storage produces JSONL results with class names, confidence values, and normalised boxes. Published pricing currently lists US$3.465 per training node-hour and US$2.222 per batch-prediction node-hour ([Vertex batch prediction](https://cloud.google.com/vertex-ai/docs/image-data/object-detection/get-predictions), [Vertex AutoML pricing](https://cloud.google.com/vertex-ai/pricing#pricing-for-automl-models)). It misses the top five for this repository because the images already live in private S3; copying them into same-region GCS adds egress, duplicate storage, credentials, and cross-cloud operations without a clear model-quality advantage. It becomes more attractive if the project moves to GCP or already has Google Cloud credits.

## Bootstrap-only option — Grounding DINO, optionally with SAM 2

Grounding DINO accepts text category names or referring expressions and returns boxes and phrases. Its paper reports 52.5 AP on zero-shot COCO transfer, and its original implementation is Apache 2.0 ([Grounding DINO paper](https://arxiv.org/abs/2303.05499), [official repository](https://github.com/IDEA-Research/GroundingDINO)). It is useful when the project knows the class names but has too few boxes to train a detector.

It should not be the default recurring engine once classes are fixed: it is heavier, prompt- and threshold-sensitive, and harder to serve at YOLO/RF-DETR throughput. Use it to create pseudo-labels, review them, and train the closed-set model. Adding SAM 2 converts proposed boxes into masks, but SAM 2 does not supply semantic labels by itself and is unnecessary when the requirement is only bounding boxes. Meta releases SAM 2 under Apache 2.0 ([Meta SAM 2](https://ai.meta.com/blog/segment-anything-2-video/)).

## Cost interpretation

Comparing only API price per image is misleading. The relevant formula is:

```text
all-in cost = inference + training + GPU idle time + S3 requests/egress
            + queue/database operations + human correction time
```

For self-hosting, measure sustained end-to-end images/hour, including S3 download, decode, preprocessing, inference, and Supabase writes:

```text
self-host compute per 1,000 images
  = GPU hourly price / sustained images per hour * 1,000
```

For Roboflow, model the subscription floor plus upload/storage/training/batch credits, not just the batch inference line. For AWS, include every inference-unit hour from model start until model stop. The fairest quality-adjusted metric is **cost per 1,000 accepted images**, including reviewer labour.

## Recommended architecture

Introduce a stable internal provider seam:

```ts
interface DetectionProvider {
  detectMany(
    inputs: Array<{ imageId: string; objectKey: string }>,
    config: {
      modelVersion: string;
      confidenceThreshold: number;
      classMapVersion: string;
    },
    signal: AbortSignal,
  ): Promise<ImagePrediction[]>;
}
```

Each adapter should hide provider-specific presigning/upload, batching, polling/webhooks, rate limits, retries, and coordinate conversion. Orchestration remains outside the adapter.

Suggested durable data model:

- `project_labels`: stable class IDs/names/colours.
- `annotation_jobs`: owner, project, provider/model, configuration, status, counts, timestamps.
- `annotation_job_items`: image-level queued/running/succeeded/failed state and retry data.
- `annotation_versions` or `image_annotations`: versioned suggestions and accepted human revisions, with model provenance and confidence.

Security requirements:

- Keep vendor credentials in the server/worker; never use `NEXT_PUBLIC_*` credentials or call paid inference directly from the browser.
- Use least-privilege AWS roles scoped to the relevant S3 project prefixes.
- Do not store or log signed URLs. Mint them just in time and ensure their expiry covers the provider fetch window.
- Verify webhook signatures and replay timestamps; make result writes idempotent.
- Validate ownership both when enqueueing and reading results; validate MIME by file signature, dimensions, pixels, response JSON, and coordinates.
- Never silently overwrite human boxes. Store AI suggestions separately until review/acceptance.

## Bake-off plan

Use the same data, split, augmentation policy, image resolution, and review UI for every candidate.

1. **Gold set:** 200–500 representative, manually reviewed images stratified by class, object size, density, lighting, and difficult negatives.
2. **Training set:** start with existing boxes; if insufficient, generate Grounding DINO proposals and review them. Keep the gold set untouched.
3. **Candidates:** RF-DETR Small/Medium; YOLO small/medium; the closest equivalent Roboflow Hosted model. Add TAO/AWS only if their platform benefits remain attractive after the first round.
4. **Quality:** mAP50–95, per-class AP, recall at a reviewable precision, small-object recall, false positives on empty images, and calibration by confidence threshold.
5. **Human outcome:** median correction seconds/image, accepted boxes/image, deletion/addition/move rates, and reviewer agreement. This is the primary product metric.
6. **Systems:** cold/warm images per minute and megapixels per second; p50/p95 time-to-first-result; full-batch completion; failure/retry rate; GPU utilisation and peak memory.
7. **Cost:** compute/API, training, idle capacity, storage/egress, and human review at 1,000, 10,000, and 100,000 images/month.
8. **Acceptance gate:** select the cheapest option that meets a pre-agreed per-class recall floor and reduces correction time enough to justify integration.

Do not rank models solely using their vendors' COCO tables. Those tables use different versions, precisions, runtimes, hardware, preprocessing, and sometimes batch sizes. The project's real image distribution is the only trustworthy final comparison.

## Risks and contrarian considerations

- **The model may not be the bottleneck.** S3 reads, image decode, EXIF normalisation, database writes, and reviewer UX can dominate end-to-end time.
- **“Free” can be expensive.** A weak generic COCO model creates enough correction work to cost more than a paid service.
- **Auto-labeling can amplify mistakes.** Reviewers may accept plausible incorrect boxes faster than they notice them. Track provenance and audit a random sample of accepted predictions.
- **Class definitions matter.** Fixed names are not enough; define inclusion/exclusion rules and edge cases before benchmarking.
- **Small and dense objects need special handling.** Higher input resolution, tiling/SAHI, or class-specific thresholds may improve recall but reduce throughput.
- **Confidence is not universal.** A threshold of 0.5 from one model is not comparable to 0.5 from another; calibrate by class on the gold set.
- **Hosted privacy can dominate the decision.** A cheap API is irrelevant if its data retention, training-use, residency, or deletion terms conflict with project requirements.

## Open questions

1. What are the exact classes and how visually/domain-specific are they?
2. How many reviewed boxes exist per class, including negative images?
3. What are the typical and maximum image dimensions, and are small objects important?
4. What monthly volumes and acceptable batch-completion times should be designed for?
5. Will the product remain open-source/educational, or could it become proprietary SaaS?
6. Can the team operate an NVIDIA GPU worker, and what hardware/cloud credits are available?
7. Are images allowed to leave the existing AWS region/account?

## Final recommendation

Run a **three-way pilot**:

1. **RF-DETR Small/Medium self-hosted** — recommended production baseline.
2. **Ultralytics YOLO small/medium self-hosted** — throughput and ease-of-use challenger, subject to licensing.
3. **Roboflow Hosted** — low-operations managed baseline.

Use **Grounding DINO** only if more initial training boxes are needed. Defer **NVIDIA TAO** until a need for its optimisation/deployment stack is demonstrated, and keep **AWS Custom Labels** as the AWS-native fallback.

This preserves a clean path: pilot rapidly, measure real reviewer savings, then choose hosted convenience or self-hosted economics based on evidence rather than model-brand reputation.

## Sources

- [RF-DETR documentation](https://rfdetr.roboflow.com/latest/) — training, inference, formats, models, and deployment.
- [RF-DETR official repository](https://github.com/roboflow/rf-detr) — source, licensing, and implementation.
- [RF-DETR paper](https://arxiv.org/abs/2511.09554) — architecture and reported benchmarks.
- [Ultralytics predict mode](https://docs.ultralytics.com/modes/predict) — bulk inputs, streaming, batches, and results.
- [Ultralytics YOLO26](https://docs.ultralytics.com/models/yolo26) — current model family, exports, and benchmarks.
- [Ultralytics licensing](https://www.ultralytics.com/license) — AGPL-3.0 and Enterprise distinction.
- [Roboflow pricing and plans](https://roboflow.com/pricing) — plan floor, privacy, and feature availability.
- [Roboflow credit units](https://roboflow.com/credits) — current upload, storage, labeling, training, and inference units.
- [Roboflow batch pricing](https://docs.roboflow.com/deploy/batch-processing/batch-processing-pricing) — example GPU batch charges.
- [Roboflow batch API](https://docs.roboflow.com/roboflow/roboflow-jp/depuroi/batch-processing/api-reference) — async job, progress, result, and webhook flow.
- [Roboflow batch guide](https://docs.roboflow.com/deployment/roboflow-cloud/batch-processing) — supported workflow and current entitlement wording.
- [Roboflow prediction format](https://docs.roboflow.com/workflow-blocks/run-a-model/object-detection-model) — box coordinates, class, and confidence.
- [NVIDIA TAO](https://developer.nvidia.com/tao-toolkit) — cost/licensing statement and platform scope.
- [TAO overview](https://docs.nvidia.com/tao/tao-toolkit/latest/text/overview.html) — supported model families, formats, and export path.
- [TAO Grounding DINO auto-labeling](https://docs.nvidia.com/tao/tao-toolkit/latest/text/data_services/auto-label/grounding_dino.html) — batch directory pipeline and class prompts.
- [NVIDIA Triton batching](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/batcher.html) — dynamic batching behaviour and tuning.
- [AWS Rekognition pricing](https://aws.amazon.com/rekognition/pricing/) — training/inference-hour charging and examples.
- [AWS Custom Labels API](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectCustomLabels.html) — S3 input and prediction response.
- [AWS Custom Labels output](https://docs.aws.amazon.com/rekognition/latest/customlabels-dg/detecting-custom-labels.html) — class, confidence, and bounding-box example.
- [AWS Rekognition quotas](https://docs.aws.amazon.com/general/latest/gr/rekognition.html) — TPS, model, unit, and dataset limits.
- [Vertex AI object-detection batch prediction](https://cloud.google.com/vertex-ai/docs/image-data/object-detection/get-predictions) — GCS manifest and output schema.
- [Vertex AI pricing](https://cloud.google.com/vertex-ai/pricing#pricing-for-automl-models) — AutoML training and batch node-hour rates.
- [Grounding DINO paper](https://arxiv.org/abs/2303.05499) — open-set detection approach and zero-shot results.
- [Grounding DINO official repository](https://github.com/IDEA-Research/GroundingDINO) — implementation and Apache 2.0 licence.
- [Meta SAM 2](https://ai.meta.com/blog/segment-anything-2-video/) — capability and Apache 2.0 release.

## Research notes

- Research depth: focused comparison of five options.
- Source preference: official documentation, official repositories, and primary papers.
- Pricing and product facts were checked on 10 September 2026 and can change.
- The configured Firecrawl CLI/API was unavailable in this workspace, so collection used direct web research against the same primary-source standard.

## Rerun inputs

```yaml
workflow: firecrawl-deep-research
topic: bulk fixed-class image object detection and auto-labeling for a Next.js/S3/Supabase annotation tool
depth: focused
output: markdown
shortlist: [RF-DETR, Ultralytics YOLO, Roboflow Hosted, NVIDIA TAO/Triton, AWS Rekognition Custom Labels]
```
