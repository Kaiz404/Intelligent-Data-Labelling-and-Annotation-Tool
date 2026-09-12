# Roboflow Hosted Auto-Labeling Implementation Plan

**Prepared:** 11 September 2026  
**Project:** Data Annotation Tool  
**Decision:** Use a custom Roboflow-hosted object-detection model for fixed project classes.

## Architecture update — multi-tenant gateway (superseded the single fixed-class model)

This platform is a **gateway for many end users**, not a single-tenant tool with one fixed class list. Any user of the app can create their own project with their own custom classes; all of it is routed through one Roboflow account that the app's server owns. Two decisions were made that change the rest of this document:

1. **Per-project custom classes**, not one shared taxonomy — every user-created project defines its own class list.
2. **Inference-only** — user-uploaded images are never added to a Roboflow dataset/project. Roboflow is used purely as a stateless prediction API; the app's own S3 + Supabase remain the only permanent store. This sidesteps the free-tier's "all projects are public on Roboflow Universe" problem entirely for real user data, since no real image ever becomes part of a Roboflow dataset.

**Chosen mechanism:** a single shared Roboflow **Workflow** (`gateway-zero-shot-detect`, provisioned in the workspace below) wrapping the **YOLO-World** zero-shot object-detection block. `class_names` is passed as a runtime parameter per request, so one workflow serves every project's arbitrary class list — no per-user/per-project Roboflow project needs to be created, and nothing about a user's classes or images is published on Universe. Verified end-to-end with a live call returning standard `{x, y, width, height, class, confidence}` predictions (see "Coordinate conversion" below — unchanged).

Provisioned in this session:

- Workspace slug: `kais-workspace-qpu1k`
- Workflow: `gateway-zero-shot-detect` (inputs: `image`, `class_names`, `confidence`; output: `predictions`)
- Server API key stored in `.env` as `ROBOFLOW_API_KEY` (full-access — scoped keys require the paid Advanced API Keys feature, unavailable on the free plan)

**Known trade-off:** zero-shot detection is materially less accurate than the fine-tuned closed-set detector this document originally recommended (see `AI_AUTO_LABELING_RESEARCH.md`). This is the right MVP choice given free-tier + arbitrary-per-project-classes + no-training-data constraints, but expect more manual correction per box than a trained model. A later upgrade path (out of scope for MVP): accumulate reviewed corrections per popular class set, then fine-tune and swap in a real model — Roboflow's Project Deployment (`project_deployment_*` tools) with Active Learning supports exactly this transition without changing the client-facing endpoint shape, if you're willing to accept per-project Roboflow projects (and their public-on-Universe exposure) at that point.

**Operational risk to track:** the free plan's ~15 credits/month is a single pool shared across *all* users of the app, not per-user. Serverless execution time (500 sec/credit) is billed per inference call; monitor usage at `app.roboflow.com/kais-workspace-qpu1k/settings/usage` and consider per-user/day rate limiting before opening this up broadly.

The remainder of this document (env vars, data model, phases, etc.) should be read with this update in mind — anywhere it says "fixed project classes" or "train a model," the MVP path is now the shared zero-shot workflow described above instead.

## Outcome

The fastest credible MVP is:

```text
User selects images
  -> authenticated Next.js route
  -> short-lived signed S3 URL per image
  -> Roboflow Serverless Hosted API
  -> normalize predictions to project label IDs + pixel XYWH
  -> persist AI suggestions in Supabase
  -> user reviews/edits/accepts them in the existing Konva editor
```

This uses Roboflow for model hosting and inference but keeps the application's private S3 bucket and Supabase database as the system of record. It does not upload the entire production image library into a permanent Roboflow dataset merely to run inference.

For the initial prototype, process one Roboflow request per image with a concurrency limit of approximately 3. The existing upload queue already uses three concurrent files, and the Roboflow Serverless Hosted API automatically scales. Once the complete user flow works, true asynchronous Roboflow Batch Processing can replace the per-image fan-out for very large jobs.

## Important free-tier constraint

The free Public plan currently includes 15 credits per month, training, cloud-hosted deployment, and Workflows. However, **all datasets and models on this plan are public on Roboflow Universe**. Roboflow explicitly warns that copyrighted, proprietary, NSFW, or personally identifiable data should not be published on the free plan ([plans and pricing](https://roboflow.com/pricing), [public-project guidance](https://docs.roboflow.com/datasets/make-a-project-public)).

True Roboflow Batch Processing is **not** part of the free-tier plan described by the current detailed documentation; that guide says it is available on Growth and Enterprise plans. The free prototype must therefore fan out controlled requests to the Serverless Hosted API rather than submit one native Roboflow batch job ([current Batch Processing guide](https://docs.roboflow.com/deployment/roboflow-cloud/batch-processing)).

Therefore, the free tier is sufficient only when:

- the training and test images are non-sensitive and may legally be public;
- the class definitions and trained model may be public;
- prototype-scale credit limits are acceptable; and
- production privacy, SLA, native Batch Processing, and key-scoping requirements are out of scope.

If any test image must remain private, use Roboflow's private trial or Core plan rather than the free workspace.

## Recommended Roboflow choices

### Project and model

- Create one Roboflow **Object Detection** project.
- Use class names that exactly match the application's canonical class names.
- Begin with a small supported detector or Roboflow Instant for a smoke test.
- For the meaningful pilot, train an RF-DETR or another Roboflow-supported detector from a public checkpoint. Roboflow recommends a pretrained model for new object-detection projects ([training documentation](https://docs.roboflow.com/guides/model-training)).
- Record the immutable model reference as `<project-slug>/<version>`. Do not silently point production at a newly trained version.

### Deployment path

Use the **Serverless Hosted API** first. It supports REST calls to deployed models, automatically scales, and accepts either image files or image URLs. Requests are limited to 20 MB, and Roboflow notes that images are resized to the model input resolution during processing ([Serverless Hosted API guide](https://docs.roboflow.com/guides/run-model-serverless-api)).

Do not call Roboflow directly from the browser. Its private API key grants bearer access to workspace data and models and must be treated like a password. Workspace-scoped keys are available generally, but permission-scoped keys are Enterprise-only ([API-key guidance](https://docs.roboflow.com/developer/authentication/find-your-roboflow-api-key), [scoped keys](https://docs.roboflow.com/developer/authentication/scoped-api-keys)).

## What must be provisioned

### 1. Roboflow account resources

- Public workspace for non-sensitive MVP data, or private trial/Core workspace.
- Object Detection project.
- Fixed class list.
- Annotated training, validation, and test images.
- Frozen dataset version.
- Trained model version.
- Workspace private API key.
- Optional Workflow containing a single object-detection model and class/confidence filtering. A Workflow is useful if preprocessing or postprocessing will be changed in Roboflow without changing application code; it is not required for the first direct-model integration.

### 2. Application environment values

Add server-only configuration (already provisioned in `.env`/`.env.example` this session):

```dotenv
ROBOFLOW_API_KEY=
ROBOFLOW_API_URL=https://serverless.roboflow.com
ROBOFLOW_WORKSPACE=kais-workspace-qpu1k
ROBOFLOW_WORKFLOW_ID=gateway-zero-shot-detect
ROBOFLOW_CONFIDENCE=0.40
```

`ROBOFLOW_WORKFLOW_ID` replaces the earlier `ROBOFLOW_MODEL_ID`/`ROBOFLOW_OVERLAP` design: there is no per-project model ID because the shared workflow is zero-shot and takes the class list as a runtime parameter instead. Only the workflow ID and thresholds are candidates for public display. The API key must never use a `NEXT_PUBLIC_` prefix, appear in client JavaScript, logs, URLs returned to clients, or stored job configuration.

### 3. Durable application data

The existing `images.annotation` JSONB column can hold boxes, but the editor currently ignores it and stores annotations in `sessionStorage`. A usable end-to-end feature must first make annotations durable.

Recommended MVP tables:

#### `project_labels`

| Column | Purpose |
|---|---|
| `id uuid` | Stable application label ID |
| `project_id uuid` | Owning project |
| `name text` | User-facing name |
| `color text` | Canvas colour |
| `provider_class_name text` | Exact Roboflow class mapping |
| `created_at timestamptz` | Audit field |

Use a unique constraint on `(project_id, lower(name))` and RLS through project ownership.

#### `annotation_jobs`

| Column | Purpose |
|---|---|
| `id uuid` | Client-visible job ID |
| `project_id uuid` | Scope and RLS parent |
| `created_by uuid` | Requesting user |
| `provider text` | `roboflow` |
| `model_id text` | Immutable `slug/version` |
| `status text` | `queued`, `running`, `completed`, `partial`, `failed`, `cancelled` |
| `total_items integer` | Progress denominator |
| `completed_items integer` | Successful count |
| `failed_items integer` | Failure count |
| `created_at`, `started_at`, `finished_at` | Audit/timing |

#### `annotation_job_items`

| Column | Purpose |
|---|---|
| `job_id uuid` | Parent job |
| `image_id uuid` | Image to process |
| `status text` | Per-image state |
| `attempt_count integer` | Retry control |
| `error_code`, `error_message text` | Actionable failure information |
| `provider_inference_id text` | Provider correlation when returned |
| `started_at`, `finished_at` | Timing |

Use a unique constraint on `(job_id, image_id)`.

#### `annotation_versions`

| Column | Purpose |
|---|---|
| `id uuid` | Version ID |
| `image_id uuid` | Parent image |
| `source text` | `ai`, `human`, or `ai_edited` |
| `review_status text` | `suggested`, `accepted`, or `rejected` |
| `model_id text` | Model provenance |
| `boxes jsonb` | Canonical application boxes |
| `created_by uuid` | User or worker identity |
| `created_at`, `reviewed_at` | Audit fields |

The quickest narrower implementation can store the current version in `images.annotation`, but job status still needs separate storage and the document must retain source, confidence, model version, and review status. Separate versions prevent AI results from silently overwriting human work.

All new tables require RLS matching the existing image-parent/project-owner pattern.

### 4. Background execution

There are two rollout levels.

#### Level A — fastest MVP, no new queue provider

- `POST /api/annotations/auto-label` accepts a small set of image IDs.
- The authenticated route verifies ownership, creates a job row, and processes images with a small concurrency limit.
- For each image it generates a short-lived S3 GET URL, calls Roboflow, normalizes the response, and saves suggestions.
- The client remains open and polls `GET /api/annotations/jobs/{jobId}`.
- Cap MVP jobs to a small number such as 25–50 images so the deployment's request-duration limit is not exceeded.

This is adequate to prove the model and review UX, but it is not reliable if the request is interrupted or the deployment has a short serverless timeout.

#### Level B — production-ready durable jobs

- The create-job route only validates and inserts rows, then returns `202 { jobId }`.
- A separately deployed worker claims queued items from Supabase and performs Roboflow calls.
- The worker retries transient `429` and `5xx` responses with exponential backoff and jitter, records terminal per-image errors, and can resume after restart.
- The UI polls or subscribes through Supabase Realtime.
- A reconciliation task finds stuck items whose leases expired.

This worker can be a small Node or Python process; it does not require a GPU because inference is hosted. It needs network access, read-only access to the relevant S3 objects, database write access limited to annotation job/result tables, and the Roboflow key.

For genuinely large batches on an eligible paid plan, a later adapter can stage inputs and submit a Roboflow Batch Processing job. Roboflow then provisions CPU/GPU capacity, exposes progress, and exports JSONL or CSV results. Single-image staging is recommended up to 5,000 images; above that the HTTP API accepts `.tar` shards containing up to 500 images each. Batch Processing is asynchronous, but it introduces staging/export/webhook integration and is unnecessary for the first product test ([Batch Processing API](https://docs.roboflow.com/deployment/roboflow-cloud/batch-processing)).

## Deep module and interface

Do not introduce a generic multi-provider abstraction yet; Roboflow is the only selected production adapter. Instead, create one deep `lib/roboflow/` module whose small interface hides HTTP authentication, timeouts, retries, response validation, and coordinate conversion:

```ts
type RoboflowDetection = {
  labelName: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

async function detectImage(input: {
  imageUrl: string;
  classNames: string[]; // this project's custom class list, passed to the shared zero-shot workflow at call time
  confidence: number;
  signal?: AbortSignal;
}): Promise<{
  image: { width: number; height: number };
  detections: RoboflowDetection[];
}>;
```

`detectImage` calls the shared workflow (`ROBOFLOW_WORKFLOW_ID`) via `POST https://serverless.roboflow.com/{ROBOFLOW_WORKSPACE}/workflows/{ROBOFLOW_WORKFLOW_ID}`, not a per-project model endpoint — there is no `modelId`/`overlap` because the workflow is zero-shot (YOLO-World) and takes `class_names` per request instead of being trained on a fixed taxonomy.

Callers should not know Roboflow response field names, URL construction, query-string authentication, retry policy, or centre-to-corner conversion. Tests cross this same seam using an injected/fake HTTP transport.

The Hosted API returns centre-based pixel coordinates:

```json
{
  "image": { "width": 2048, "height": 1080 },
  "predictions": [
    {
      "x": 883.5,
      "y": 676,
      "width": 795,
      "height": 808,
      "confidence": 0.985,
      "class": "car",
      "class_id": 0
    }
  ]
}
```

Convert to the current canvas format:

```text
left = x - width / 2
top  = y - height / 2
```

Validate finite values, positive size, known class mapping, and image bounds. Clamp minor edge overflow, but record/reject structurally invalid responses. Roboflow documents the response schema and these conversion rules in its [object-detection API guide](https://docs.roboflow.com/deploy/serverless/object-detection).

## Application changes by area

### Server and data

- Add the database migration and RLS policies for labels, jobs, items, and annotation versions.
- Add manual TypeScript types under `lib/types/`.
- Add `lib/roboflow/` with configuration, client, schema validation, and coordinate conversion.
- Add `lib/actions/annotations.ts` or authenticated routes for job creation, status, retry, and review acceptance.
- Add `createImageReadUrl(key, expiresIn)` support so inference URLs can be short-lived and purpose-specific.
- Persist image width, height, and normalised orientation at upload or first decode. Accurate coordinate mapping should not rely only on the provider response.
- Update `lib/images.ts` so statuses distinguish unannotated, AI suggested/in progress, and accepted annotation.

### User interface

- On the project page, use the existing selected image IDs and add **AI Annotate selected**.
- In the annotation toolbar, replace “Coming soon” with **Annotate this image**, **Retry**, and job/review state.
- Add a confirmation dialog showing image count, model version, confidence threshold, and credit/privacy warning.
- Display queued/running/completed/failed progress and allow retrying failed items.
- Load durable AI suggestions into the existing Konva canvas.
- Visually identify AI-suggested boxes and retain confidence in the side panel.
- Provide **Accept all**, **Reject**, and ordinary box editing before saving a human-reviewed version.
- Never overwrite an accepted human version automatically.

### Configuration and documentation

- Add the Roboflow variables to `.env.example` and validate them on the server.
- Document Roboflow as an external service and update the mocked-vs-real matrix in `AGENTS.md` when implementation begins.
- Record the trained model ID/version and class-map version in every result.

## Suggested route contracts

### Create job

```http
POST /api/annotations/auto-label
Content-Type: application/json

{
  "projectId": "uuid",
  "imageIds": ["uuid"],
  "confidence": 0.4,
  "overlap": 0.3
}

202 Accepted
{
  "jobId": "uuid",
  "status": "queued",
  "totalItems": 12
}
```

Server rules:

- authenticate with Supabase;
- verify every image belongs to the user's project;
- cap image count and total source bytes;
- reject a model/class-map mismatch;
- use an idempotency key to avoid duplicate jobs from retries; and
- do not accept object keys or signed URLs from the browser.

### Read job

```http
GET /api/annotations/jobs/{jobId}

200 OK
{
  "status": "running",
  "totalItems": 12,
  "completedItems": 8,
  "failedItems": 1
}
```

### Accept/edit suggestions

```http
POST /api/annotations/{imageId}/review
Content-Type: application/json

{
  "sourceVersionId": "uuid",
  "decision": "accept-edited",
  "boxes": []
}
```

Use optimistic concurrency so accepting an old suggestion cannot overwrite a newer human edit.

## Implementation phases

### Phase 0 — Roboflow provisioning and manual proof

1. Confirm all test data may be public, or activate a private trial.
2. Create the object-detection project and fixed classes.
3. Upload a small annotated dataset in COCO or YOLO format, or annotate it in Roboflow. Roboflow recommends its web UI below roughly 1,000 images and CLI/API upload above that ([data upload guide](https://docs.roboflow.com/datasets/create-and-upload/adding-data), [dataset upload API](https://docs.roboflow.com/api-reference/images/upload-dataset)).
4. Generate a dataset version and train a small model.
5. Test 20 held-out images manually through the Hosted API.
6. Freeze the chosen model ID/version and determine initial per-class thresholds.

**Exit condition:** response boxes are useful enough that correcting them is faster than drawing from scratch.

### Phase 1 — single-image vertical slice

1. Add server-only Roboflow configuration.
2. Add and test the Roboflow deep module.
3. Add durable project labels and annotation versions.
4. Wire **Annotate this image** through server inference to the canvas.
5. Support edit, accept, and reject.

**Exit condition:** one S3 image can be inferred, persisted, reloaded, edited, and accepted without exposing credentials or using `sessionStorage`.

### Phase 2 — small bulk MVP

1. Add job and job-item tables.
2. Add **AI Annotate selected** to the project page.
3. Process with controlled concurrency, progress reporting, partial success, and retries.
4. Measure credit use and end-to-end duration from response headers/job timings.

**Exit condition:** a 25–50 image job completes with resumable status and failed items can be retried independently.

### Phase 3 — hardening

1. Move work to a durable worker if jobs may outlive an HTTP request.
2. Add rate limiting, leases, cancellation, dead-letter/reconciliation handling, and observability.
3. Add per-project model/class-map configuration if projects use different classes.
4. If the team moves to an eligible paid plan, evaluate Roboflow Batch Processing for jobs large enough that staging/export complexity is justified.
5. Upgrade to a private plan before processing non-public data.

**Exit condition:** browser closure, route restart, provider throttling, and one bad image do not lose or duplicate work.

## Test plan

### Unit tests

- Roboflow response validation.
- Centre-based box to top-left XYWH conversion.
- Bounds clamping and malformed-number rejection.
- Exact and case-handled class-to-label mapping.
- Retry classification: retry `429`/`5xx`/network timeouts; do not retry invalid requests or unknown classes indefinitely.
- Idempotent result writes.

### Integration tests

- Authenticated owner can create and view a job.
- Non-owner cannot submit or read another project's image/job.
- Mock Roboflow response creates a suggested annotation version.
- Partial failures update counts correctly.
- Accepted human boxes are never replaced by a later AI retry.
- Expired S3 URLs are regenerated server-side.

### Manual acceptance tests

- 20-image smoke test on representative data.
- 50-image bulk test with one invalid/corrupt image.
- Close/reload the browser during processing.
- Rotate an EXIF-oriented phone image and verify box alignment.
- Compare median correction time with drawing boxes manually.
- Roll the Roboflow key and verify the old key no longer works.

## Credit budget for the free prototype

Current published credit units are:

- 10,000 uploaded images per credit;
- 5,000 stored images per credit per month;
- 20,000 version images per credit;
- 30 minutes of GPU training per credit;
- 500 seconds of Serverless API V2 inference per credit; and
- 15 minutes of GPU Batch Processing per credit on plans that provide access to Batch Processing.

Roboflow's current serverless example for RF-DETR Small charges a minimum-equivalent 0.2 credits per 1,000 warm images and 2.2 credits per 1,000 cold-start images. Cold starts can take a few seconds after an idle period ([credit units](https://roboflow.com/credits), [V2 pricing formula](https://docs.roboflow.com/deploy/serverless-hosted-api-v2/pricing)).

A small dataset and a short training run should fit inside 15 monthly credits, but training time is the largest uncertainty. Track actual usage rather than relying on a theoretical image count. The free plan stops credit-consuming features when included/prepaid credits are exhausted, so it is naturally capped rather than producing flex charges.

## Decisions still required before implementation

1. Can every training and test image be public during the free-tier prototype?
2. What are the exact classes and their inclusion/exclusion rules?
3. Is there already enough reviewed annotation data to train a detector?
4. Should AI annotation run only on explicit selection or automatically after upload?
5. What is the maximum MVP job size and acceptable completion time?
6. Where will a durable worker run if Phase 3 is required?

## Recommended immediate next step

Provision the Roboflow project manually and run the Phase 0 proof before changing the application. Use 20 genuinely representative held-out images. If the model does not reduce correction time, application integration will not fix the underlying quality problem. If it passes, implement Phase 1 as the smallest end-to-end vertical slice and only then add bulk job orchestration.

## Sources

- [Roboflow pricing](https://roboflow.com/pricing)
- [Roboflow credits](https://roboflow.com/credits)
- [Create an object-detection project](https://docs.roboflow.com/datasets/create-and-upload/create-a-project)
- [Upload images and annotations](https://docs.roboflow.com/datasets/create-and-upload/adding-data)
- [Upload a dataset through the API](https://docs.roboflow.com/api-reference/images/upload-dataset)
- [Train a model](https://docs.roboflow.com/guides/model-training)
- [Run a model with the Serverless Hosted API](https://docs.roboflow.com/guides/run-model-serverless-api)
- [Serverless V2 REST interface](https://docs.roboflow.com/deploy/serverless-hosted-api-v2/use-with-the-rest-api)
- [Serverless V2 pricing](https://docs.roboflow.com/deploy/serverless-hosted-api-v2/pricing)
- [Object-detection response format](https://docs.roboflow.com/deploy/serverless/object-detection)
- [Roboflow API keys](https://docs.roboflow.com/developer/authentication/find-your-roboflow-api-key)
- [Scoped API keys](https://docs.roboflow.com/developer/authentication/scoped-api-keys)
- [Batch Processing and HTTP API](https://docs.roboflow.com/deployment/roboflow-cloud/batch-processing)
- [Batch Processing pricing examples](https://docs.roboflow.com/deploy/batch-processing/batch-processing-pricing)
- [Public-project privacy guidance](https://docs.roboflow.com/datasets/make-a-project-public)
