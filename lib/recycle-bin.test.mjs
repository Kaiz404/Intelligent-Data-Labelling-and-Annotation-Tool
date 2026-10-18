// node --test lib/recycle-bin.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Same dependency-free TypeScript loading approach as coco-import.test.mjs.
function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const compiled = { exports: {} };
  new Function("require", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, compiled.exports);
  return compiled.exports;
}

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = (projectId, n, file = "a.jpg") => `projects/${projectId}/images/${id(900 + n)}/${file}`;
const P = { a: id(1), b: id(2), c: id(3), x: id(4), z: id(5) };
const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

function binRow(itemId, fields) {
  return {
    id: itemId, user_id: "user", image_id: null, description: null, image_count: 0, size_bytes: 0,
    object_keys: [], cover_object_key: null, deleted_at: "2026-10-01T00:00:00.000Z",
    expires_at: FUTURE, purge_started_at: null, name: "item", project_name: "Project", ...fields,
    ...(fields.object_keys ? { cover_object_key: fields.object_keys[0] ?? null } : {}),
  };
}

function setup({ bin = [], projects = [], images = [], thumbnails = [], failKeys = [], missingTable = false, rpc } = {}) {
  process.env.AWS_REGION = "test-region";
  process.env.AWS_S3_BUCKET = "bucket";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";

  const log = [];
  const revalidated = [];
  const rpcCalls = [];
  const tables = {
    recycle_bin_items: bin.map((row) => ({ ...row })),
    projects: projects.map((projectId) => ({ id: projectId })),
    images: images.map((imageId) => ({ id: imageId })),
  };

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    async rpc(name, args) {
      rpcCalls.push([name, args]);
      return rpc ? rpc(name, args, tables) : { data: null, error: null };
    },
    from(table) {
      let operation = "select";
      let payload;
      const filters = [];
      let bounds;
      const query = {
        select() { return query; },
        delete() { operation = "delete"; return query; },
        update(values) { operation = "update"; payload = values; return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        gt(column, value) { filters.push((row) => row[column] > value); return query; },
        lt(column, value) { filters.push((row) => row[column] < value); return query; },
        order() { return query; },
        range(from, to) { bounds = [from, to]; return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (missingTable && table === "recycle_bin_items") {
              return { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.recycle_bin_items' in the schema cache" } };
            }
            let found = tables[table].filter((row) => filters.every((filter) => filter(row)));
            if (operation === "delete") {
              tables[table] = tables[table].filter((row) => !found.includes(row));
              for (const row of found) log.push(`db:delete:${row.id}`);
            }
            if (operation === "update") {
              for (const row of found) {
                Object.assign(row, payload);
                log.push(`db:mark:${row.id}`);
              }
            }
            if (bounds) found = found.slice(bounds[0], bounds[1] + 1);
            return { data: found.map((row) => ({ ...row })), error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };

  const command = (name) => ({ [name]: class { constructor(input) { this.input = input; } } })[name];
  const aws = Object.fromEntries([
    "AbortMultipartUploadCommand", "CompleteMultipartUploadCommand", "CopyObjectCommand",
    "CreateMultipartUploadCommand", "DeleteObjectCommand", "GetObjectCommand", "HeadObjectCommand",
    "ListObjectsV2Command", "PutObjectCommand", "UploadPartCommand",
  ].map((name) => [name, command(name)]));
  aws.S3Client = class {
    async send(cmd) {
      const objectKey = cmd.input.Key;
      if (cmd.constructor.name === "HeadObjectCommand") {
        if (!thumbnails.includes(objectKey)) throw new Error("NotFound");
        return {};
      }
      if (cmd.constructor.name === "DeleteObjectCommand") {
        if (failKeys.includes(objectKey)) throw new Error("S3 unavailable");
        log.push(`s3:delete:${objectKey}`);
      }
      return {};
    }
  };

  const supabaseServer = { createClient: async () => client };
  const s3 = load("./uploads/s3-server.ts", {
    "@aws-sdk/client-s3": aws,
    "@aws-sdk/s3-request-presigner": { getSignedUrl: async (_client, cmd) => `signed:${cmd.input.Key}` },
    // Nothing here uploads, so the upload-only dependencies are inert.
    "@aws-sdk/s3-presigned-post": {},
    "@/lib/image-placeholder": { isThumbhash: () => false },
    "@/lib/supabase/server": supabaseServer,
    "@/lib/uploads/object-key": load("./uploads/object-key.ts"),
    "@/lib/uploads/types": {},
  });
  const bin_ = load("./recycle-bin.ts", {
    "server-only": {},
    "@/lib/ids": load("./ids.ts"),
    "@/lib/supabase/server": supabaseServer,
    "@/lib/uploads/s3-server": s3,
  });
  const actions = load("./actions/recycle-bin.ts", {
    "next/cache": { revalidatePath: (...args) => revalidated.push(args) },
    "@/lib/recycle-bin": bin_,
    "@/lib/supabase/server": supabaseServer,
  });
  const session = { supabase: client, userId: "user" };
  return { client, session, tables, log, revalidated, rpcCalls, bin: bin_, actions };
}

const remaining = (s) => s.tables.recycle_bin_items.map((row) => row.id).sort();
const row = (s, itemId) => s.tables.recycle_bin_items.find((item) => item.id === itemId);

test("permanent delete marks rows before touching S3 and takes the project's binned images with it", async () => {
  const s = setup({
    bin: [
      binRow(id(10), { kind: "project", project_id: P.a, object_keys: [
        key(P.a, 1), key(P.b, 2), "not-a-valid-key",
      ] }),
      binRow(id(11), { kind: "image", project_id: P.a, image_id: id(51), object_keys: [key(P.a, 3)] }),
      binRow(id(12), { kind: "image", project_id: P.c, image_id: id(52), object_keys: [key(P.c, 4)] }),
    ],
  });
  const result = await s.bin.permanentlyDeleteRecycleBinItems(s.session, [id(10)]);

  assert.deepEqual(result, { deleted: 2, failed: [], skipped: [] });
  assert.deepEqual(remaining(s), [id(12)]);
  // Keys outside the item's own project prefix (or malformed) are never deleted.
  assert.deepEqual(s.log, [
    `db:mark:${id(10)}`,
    `s3:delete:${key(P.a, 1)}`,
    `s3:delete:projects/${P.a}/thumbnail`,
    `db:delete:${id(10)}`,
    `db:mark:${id(11)}`,
    `s3:delete:${key(P.a, 3)}`,
    `db:delete:${id(11)}`,
  ]);
});

test("a partial S3 failure leaves the project marked (unrestorable) and its binned images untouched", async () => {
  const s = setup({
    failKeys: [key(P.a, 2)],
    bin: [
      binRow(id(10), { kind: "project", project_id: P.a, object_keys: [key(P.a, 1), key(P.a, 2), key(P.a, 3)] }),
      binRow(id(11), { kind: "image", project_id: P.a, image_id: id(51), object_keys: [key(P.a, 4)] }),
    ],
  });
  const result = await s.bin.permanentlyDeleteRecycleBinItems(s.session, [id(10)]);

  assert.equal(result.deleted, 0);
  assert.deepEqual(result.failed.map((failure) => failure.id), [id(10)]);
  assert.match(result.failed[0].error, /delete it permanently again/i);
  assert.deepEqual(remaining(s), [id(10), id(11)]);
  assert.ok(row(s, id(10)).purge_started_at, "the failed project stays marked");
  assert.equal(row(s, id(11)).purge_started_at, null, "its binned images are not claimed");
  // Every other key was still attempted; the thumbnail was not.
  assert.ok(s.log.includes(`s3:delete:${key(P.a, 1)}`) && s.log.includes(`s3:delete:${key(P.a, 3)}`));
  assert.ok(!s.log.some((entry) => entry.includes("thumbnail")));
});

test("a failed thumbnail delete keeps the project marked for a retry, which then succeeds", async () => {
  const s = setup({
    failKeys: [`projects/${P.a}/thumbnail`],
    bin: [binRow(id(10), { kind: "project", project_id: P.a, object_keys: [key(P.a, 1)] })],
  });
  const first = await s.bin.permanentlyDeleteRecycleBinItems(s.session, [id(10)]);
  assert.deepEqual(first.failed.map((failure) => failure.id), [id(10)]);
  assert.ok(row(s, id(10)).purge_started_at);

  s.log.length = 0;
  const retry = setup({ bin: s.tables.recycle_bin_items });
  assert.deepEqual(await retry.bin.permanentlyDeleteRecycleBinItems(retry.session, [id(10)]), {
    deleted: 1, failed: [], skipped: [],
  });
  assert.deepEqual(remaining(retry), []);
});

test("one bad key fails only its own image row, not the whole batch", async () => {
  const s = setup({
    failKeys: [key(P.a, 1)],
    bin: [
      binRow(id(11), { kind: "image", project_id: P.a, image_id: id(51), object_keys: [key(P.a, 1)] }),
      binRow(id(12), { kind: "image", project_id: P.a, image_id: id(52), object_keys: [key(P.a, 2)] }),
    ],
  });
  const result = await s.bin.permanentlyDeleteRecycleBinItems(s.session, [id(11), id(12)]);
  assert.equal(result.deleted, 1);
  assert.deepEqual(result.failed.map((failure) => failure.id), [id(11)]);
  assert.deepEqual(remaining(s), [id(11)]);
  assert.ok(row(s, id(11)).purge_started_at);
});

test("ids no longer in the bin are reported as skipped", async () => {
  const s = setup({
    bin: [binRow(id(10), { kind: "image", project_id: P.a, image_id: id(50), object_keys: [key(P.a, 1)] })],
  });
  assert.deepEqual(await s.bin.permanentlyDeleteRecycleBinItems(s.session, [id(10), id(99), "nope", id(10)]), {
    deleted: 1, failed: [], skipped: [id(99), "nope"],
  });
});

test("fetchRecycleBin derives project state, thumbnails, and pending deletions, hiding expired items", async () => {
  const s = setup({
    projects: [P.x],
    thumbnails: [`projects/${P.a}/thumbnail`],
    bin: [
      binRow(id(10), { kind: "project", project_id: P.a, name: "Birds", image_count: 2, size_bytes: "300", object_keys: [key(P.a, 1)], cover_thumbhash: "birdHash" }),
      binRow(id(11), { kind: "project", project_id: P.b, name: "Cats", object_keys: [key(P.b, 2)], purge_started_at: "2026-10-02T00:00:00.000Z", cover_thumbhash: "catHash" }),
      binRow(id(20), { kind: "image", project_id: P.x, image_id: id(50), name: "x.jpg", object_keys: [key(P.x, 3)], thumbhash: "xHash" }),
      binRow(id(21), { kind: "image", project_id: P.a, image_id: id(51), name: "a.jpg", object_keys: [key(P.a, 4)] }),
      binRow(id(22), { kind: "image", project_id: P.z, image_id: id(52), name: "z.jpg", object_keys: [key(P.z, 5)] }),
      binRow(id(23), { kind: "image", project_id: P.z, image_id: id(53), name: "old.jpg", object_keys: [key(P.z, 6)], expires_at: PAST }),
      binRow(id(24), { kind: "image", project_id: P.c, image_id: id(54), name: "evil.jpg", object_keys: [key(P.b, 7)] }),
      binRow(id(25), { kind: "image", project_id: P.b, image_id: id(55), name: "cat.jpg", object_keys: [key(P.b, 8)] }),
      binRow(id(26), { kind: "image", project_id: P.x, image_id: id(56), name: "half.jpg", object_keys: [key(P.x, 9)], purge_started_at: "2026-10-02T00:00:00.000Z" }),
    ],
  });
  const contents = await s.bin.fetchRecycleBin();

  // The first image's ThumbHash is the placeholder only while it is the thumbnail.
  assert.deepEqual(contents.projects.map((p) => [p.name, p.imageCount, p.sizeBytes, p.thumbnailUrl, p.thumbhash, p.deletionPending]), [
    ["Birds", 2, 300, `signed:projects/${P.a}/thumbnail`, null, false],
    ["Cats", 0, 0, `signed:${key(P.b, 2)}`, "catHash", true],
  ]);
  assert.deepEqual(contents.images.map((image) => image.thumbhash), ["xHash", null, null, null, null, null]);
  assert.deepEqual(contents.images.map((image) => [image.fileName, image.projectState, image.thumbnailUrl, image.deletionPending]), [
    ["x.jpg", "active", `signed:${key(P.x, 3)}`, false],
    ["a.jpg", "in_bin", `signed:${key(P.a, 4)}`, false],
    ["z.jpg", "gone", `signed:${key(P.z, 5)}`, false],
    // A key outside the item's own project prefix is never signed.
    ["evil.jpg", "gone", null, false],
    // Its project's permanent deletion started, so it can never be restored.
    ["cat.jpg", "gone", `signed:${key(P.b, 8)}`, false],
    ["half.jpg", "active", `signed:${key(P.x, 9)}`, true],
  ]);
  assert.ok(!Number.isNaN(Date.parse(contents.serverNow)));
});

test("a missing recycle bin table surfaces a setup error, and storage gets no bin projects", async () => {
  const s = setup({ missingTable: true });
  await assert.rejects(s.bin.fetchRecycleBin(), (error) => error instanceof s.bin.RecycleBinUnavailableError);
  await assert.rejects(s.bin.purgeExpiredRecycleBinItems(), /migration/);
  assert.deepEqual(await s.bin.fetchRecycleBinProjectIds(), []);
});

test("purge claims and deletes only expired items, including a previously failed one", async () => {
  const s = setup({
    bin: [
      binRow(id(10), { kind: "image", project_id: P.a, image_id: id(50), object_keys: [key(P.a, 1)], expires_at: PAST }),
      binRow(id(11), { kind: "image", project_id: P.a, image_id: id(51), object_keys: [key(P.a, 2)] }),
      binRow(id(12), { kind: "image", project_id: P.a, image_id: id(52), object_keys: [key(P.a, 3)], expires_at: PAST, purge_started_at: PAST }),
    ],
  });
  assert.equal(await s.bin.purgeExpiredRecycleBinItems(s.session), 2);
  assert.deepEqual(remaining(s), [id(11)]);
  assert.ok(s.log.indexOf(`db:mark:${id(10)}`) < s.log.indexOf(`s3:delete:${key(P.a, 1)}`));
});

test("storage usage gets distinct binned project ids", async () => {
  const s = setup({
    bin: [
      binRow(id(10), { kind: "project", project_id: P.a }),
      binRow(id(11), { kind: "image", project_id: P.a, image_id: id(51) }),
      binRow(id(12), { kind: "image", project_id: P.z, image_id: id(52) }),
    ],
  });
  assert.deepEqual((await s.bin.fetchRecycleBinProjectIds()).sort(), [P.a, P.z].sort());
});

test("a prepared session is reused instead of re-authenticating", async () => {
  const s = setup({
    bin: [binRow(id(10), { kind: "image", project_id: P.a, image_id: id(50), object_keys: [key(P.a, 1)], expires_at: PAST })],
  });
  let authCalls = 0;
  const getUser = s.client.auth.getUser;
  s.client.auth.getUser = async () => { authCalls += 1; return getUser(); };
  const session = await s.bin.getRecycleBinSession();
  await s.bin.fetchRecycleBin(session);
  assert.equal(await s.bin.purgeExpiredRecycleBinItems(session), 1);
  assert.equal(authCalls, 1);
});

test("restore runs projects before images and maps SQL errors to friendly messages", async () => {
  const s = setup({
    bin: [
      binRow(id(10), { kind: "project", project_id: P.a, name: "Birds" }),
      binRow(id(11), { kind: "image", project_id: P.a, image_id: id(51), name: "a.jpg", project_name: "Birds" }),
      binRow(id(12), { kind: "image", project_id: P.b, image_id: id(52), name: "b.jpg", project_name: "Cats" }),
      binRow(id(13), { kind: "image", project_id: P.z, image_id: id(53), name: "z.jpg", project_name: "Gone" }),
      binRow(id(14), { kind: "image", project_id: P.z, image_id: id(54), name: "half.jpg", project_name: "Gone" }),
      binRow(id(15), { kind: "image", project_id: P.z, image_id: id(55), name: "old.jpg", project_name: "Gone" }),
    ],
    rpc(name, { p_item_id }) {
      const codes = { [id(12)]: "RB005", [id(13)]: "RB002", [id(14)]: "RB008", [id(15)]: "RB009" };
      if (codes[p_item_id]) return { data: null, error: { code: codes[p_item_id], message: "SQL" } };
      return { data: { kind: "x" }, error: null };
    },
  });
  const results = await s.actions.restoreRecycleBinItems([id(11), id(12), id(10), id(13), id(14), id(15), id(99), "nope", id(11)]);

  assert.deepEqual(s.rpcCalls.map(([, args]) => args.p_item_id), [id(10), id(11), id(12), id(13), id(14), id(15)]);
  assert.deepEqual(results.map((result) => [result.id, result.ok]), [
    [id(11), true], [id(12), false], [id(10), true], [id(13), false],
    [id(14), false], [id(15), false], [id(99), false], ["nope", false],
  ]);
  const errorFor = (itemId) => results.find((result) => result.id === itemId).error;
  assert.equal(errorFor(id(12)), "Restore the project “Cats” first.");
  assert.equal(errorFor(id(13)), "The project was permanently deleted, so this image can't be restored.");
  assert.match(errorFor(id(14)), /deletion of this item already started/i);
  assert.match(errorFor(id(15)), /30-day limit/);
  assert.equal(errorFor(id(99)), "This item is no longer in the recycle bin.");
  assert.deepEqual(results[0], { id: id(11), ok: true, kind: "image", projectId: P.a, imageId: id(51) });
  assert.ok(s.revalidated.some(([path, type]) => path === `/projects/${P.a}` && type === "layout"));
  assert.ok(s.revalidated.some(([path]) => path === "/recycle-bin"));
});

test("move actions return expected failures instead of throwing", async () => {
  const s = setup({
    rpc(name) {
      if (name === "move_project_to_recycle_bin") {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function public.move_project_to_recycle_bin(p_project_id) in the schema cache" } };
      }
      return { data: null, error: { code: "RB003", message: "IMAGES_NOT_FOUND" } };
    },
  });
  assert.deepEqual(await s.actions.moveImagesToRecycleBin(P.a, []), { ok: false, error: "Select at least one image." });
  assert.deepEqual(await s.actions.moveImagesToRecycleBin(P.a, ["bad"]), { ok: false, error: "One or more selected images could not be found." });
  assert.deepEqual(await s.actions.moveProjectToRecycleBin("bad"), { ok: false, error: "Project not found or you do not have access." });
  assert.equal(s.rpcCalls.length, 0);

  assert.deepEqual(await s.actions.moveImagesToRecycleBin(P.a, [id(50)]), { ok: false, error: "One or more selected images could not be found." });
  const missing = await s.actions.moveProjectToRecycleBin(P.a);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /nothing was changed.*npx supabase db push/);
  assert.equal(s.revalidated.length, 0);

  const signedOut = setup();
  signedOut.client.auth.getUser = async () => ({ data: { user: null } });
  assert.deepEqual(await signedOut.actions.moveProjectToRecycleBin(P.a), { ok: false, error: "You must be signed in to delete a project." });
});

test("move images returns the new bin item ids and revalidates the project", async () => {
  const s = setup({ rpc: () => ({ data: [id(70), id(71)], error: null }) });
  assert.deepEqual(await s.actions.moveImagesToRecycleBin(P.a, [id(50), id(51), id(50)]), { ok: true, itemIds: [id(70), id(71)] });
  assert.deepEqual(s.rpcCalls, [["move_images_to_recycle_bin", { p_project_id: P.a, p_image_ids: [id(50), id(51)] }]]);
  assert.ok(s.revalidated.some(([path, type]) => path === `/projects/${P.a}` && type === "layout"));
});

test("deleteRecycleBinItemsPermanently reports skipped ids and revalidates the bin", async () => {
  const s = setup({
    bin: [binRow(id(10), { kind: "image", project_id: P.a, image_id: id(50), object_keys: [key(P.a, 1)] })],
  });
  assert.deepEqual(await s.actions.deleteRecycleBinItemsPermanently([id(10), id(99)]), {
    deleted: 1, failed: [], skipped: [id(99)],
  });
  assert.deepEqual(remaining(s), []);
  assert.deepEqual(s.revalidated, [["/recycle-bin"]]);
});
