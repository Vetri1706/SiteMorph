import { activityCacheKey } from "../../server/cache-key";
import { getRuntimeBucket, normalizeRuntimeKey, type RuntimeBucket } from "./runtime-store";

type GuardConfig = {
  baseUrl: string;
  granularity: number;
  cacheVersion: string;
};

let guardConfig: GuardConfig | undefined;

export function bindGuardedFetch(config: GuardConfig): void {
  guardConfig = config;
}

function activityPath(key: string): string {
  return normalizeRuntimeKey(`/sitemorph-runtime/.sitemorph-cache/fortyguard-activities/${key}.json`);
}

async function persistSubmissionState(
  bucket: RuntimeBucket,
  key: string,
  status: "pending" | "failed",
  activityId: string,
  error?: string,
): Promise<void> {
  await bucket.put(activityPath(key), JSON.stringify({
    schema: "sitemorph.fortyguard-activity.v1",
    key,
    kind: "heat",
    status,
    activityId,
    savedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  }));
}

function heatActivityDescriptor(init?: RequestInit): {
  key: string;
  analyticType: string;
  analysisDate: string;
} | undefined {
  if (!guardConfig || init?.method !== "POST" || typeof init.body !== "string") return undefined;
  try {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const polygonAoi = body.polygon_aoi as { features?: Array<Record<string, unknown>> } | undefined;
    const geometry = polygonAoi?.features?.[0] as never;
    const analyticType = String(body.analytic_type ?? "");
    const dateTime = body.date_time as Record<string, unknown> | undefined;
    const analysisDate = String(dateTime?.start_date ?? "");
    if (!geometry || !["tcm", "persistence", "exceedance", "time_of_measure"].includes(analyticType) || !analysisDate) return undefined;
    const parameters: Record<string, unknown> = {
      analysisDate,
      granularity: guardConfig.granularity,
      ...(["persistence", "exceedance"].includes(analyticType) ? { thresholdCelsius: Number(body.threshold ?? 35) } : {}),
    };
    return {
      key: activityCacheKey(geometry, `heatmap:${analyticType}`, parameters, guardConfig.cacheVersion),
      analyticType,
      analysisDate,
    };
  } catch {
    return undefined;
  }
}

export async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const descriptor = guardConfig && url === `${guardConfig.baseUrl}/heatmap`
    ? heatActivityDescriptor(init)
    : undefined;
  if (!descriptor) return globalThis.fetch(input, init);

  const bucket = getRuntimeBucket();
  await persistSubmissionState(
    bucket,
    descriptor.key,
    "failed",
    "",
    `FortyGuard ${descriptor.analyticType} submission outcome is unknown for ${descriptor.analysisDate}; automatic resubmission is blocked.`,
  );

  const response = await globalThis.fetch(input, init);
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => ({})) as { data?: { activity_id?: unknown } };
  const activityId = String(payload.data?.activity_id ?? "");
  if (activityId) {
    await persistSubmissionState(bucket, descriptor.key, "pending", activityId);
  }
  return response;
}
