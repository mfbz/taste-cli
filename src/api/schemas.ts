// The Taste Engine's components (docs/superpowers/reference/openapi.json), for what taste-cli reads.
// Objects are loose so a field the server adds later never breaks the CLI; shapes Taste does not
// publish (design_system, fixes, palette, typography) stay records. Deprecated fields are optional.
import { z } from "zod";

type SectionName = z.infer<typeof SECTION_NAME>;
type BrandKitSectionName = z.infer<typeof BRAND_KIT_SECTION_NAME>;
type SubmissionStatus = z.infer<typeof SUBMISSION_STATUS>;
type SubmissionKind = z.infer<typeof SUBMISSION_KIND>;
type AdherenceStatus = z.infer<typeof ADHERENCE_STATUS>;
type SearchDepth = z.infer<typeof SEARCH_DEPTH>;
type Me = z.infer<typeof ME>;
type SubmissionAccepted = z.infer<typeof SUBMISSION_ACCEPTED>;
type Submission = z.infer<typeof SUBMISSION>;
type SubmissionList = z.infer<typeof SUBMISSION_LIST>;
type SubmissionResult = z.infer<typeof SUBMISSION_RESULT>;
type SubmissionManifest = z.infer<typeof SUBMISSION_MANIFEST>;
type EnhanceResponse = z.infer<typeof ENHANCE_RESPONSE>;
type BrandSearchCard = z.infer<typeof BRAND_SEARCH_CARD>;
type BrandSearchResults = z.infer<typeof BRAND_SEARCH_RESULTS>;
type SimilarBrandsResults = z.infer<typeof SIMILAR_BRANDS_RESULTS>;
type SearchSubmission = z.infer<typeof SEARCH_SUBMISSION>;
type SearchSubmissionList = z.infer<typeof SEARCH_SUBMISSION_LIST>;
type AdherenceAccepted = z.infer<typeof ADHERENCE_ACCEPTED>;
type AdherenceJob = z.infer<typeof ADHERENCE_JOB>;
type AdherenceJobList = z.infer<typeof ADHERENCE_JOB_LIST>;
type AdherenceVerdict = z.infer<typeof ADHERENCE_VERDICT>;

// Request bodies are built by taste-cli itself, so they are types only.
type SubmissionCreate = {
  url: string;
  force?: boolean;
  enable_deep_analysis?: boolean;
  sections?: SectionName[] | null;
};
type BrandSearchRequest = {
  query: string;
  depth?: SearchDepth;
  top_k?: number;
  filters?: {
    page_type?: z.infer<typeof PAGE_TYPE> | null;
    industry?: z.infer<typeof INDUSTRY> | null;
    hue?: z.infer<typeof HUE> | null;
    layout?: z.infer<typeof LAYOUT> | null;
  } | null;
};

const STRING_LIST = z.array(z.string());
const LOOSE_RECORD = z.record(z.string(), z.unknown());

const SECTION_NAME = z.enum([
  "profile",
  "layout",
  "colors",
  "typography",
  "surfaces",
  "elevation",
  "interactions",
  "actions",
  "navigation",
  "data_display",
  "structure",
  "icons",
  "assets",
  "sections",
  "brand_assets",
]);
const BRAND_KIT_SECTION_NAME = z.enum([
  "profile",
  "logo",
  "colors",
  "typography",
  "photography",
  "graphics",
  "applications",
  "layout",
  "buttons",
  "cards",
  "motion",
  "rules",
]);
const SUBMISSION_STATUS = z.enum([
  "accepted",
  "queued",
  "crawling",
  "extracting",
  "completed",
  "failed",
]);
const SUBMISSION_KIND = z.enum(["website", "brand_kit"]);
const ADHERENCE_STATUS = z.enum([
  "accepted",
  "extracting",
  "judging",
  "completed",
  "failed",
]);
const SEARCH_DEPTH = z.enum(["fast", "deep"]);
const PAGE_TYPE = z.enum([
  "homepage",
  "about",
  "pricing",
  "careers",
  "case_study",
  "features",
  "customer_stories",
  "portfolio",
  "product",
  "collections",
  "solutions",
  "blog",
  "landing_page",
  "team",
  "services",
]);
const INDUSTRY = z.enum([
  "saas",
  "ai",
  "design",
  "creative_agency",
  "fintech",
  "branding",
  "developer_tools",
  "fashion",
  "venture_capital",
  "entertainment",
  "beverage",
  "food",
  "cybersecurity",
  "e_commerce",
  "architecture",
  "cloud_infrastructure",
  "ai_infrastructure",
  "healthcare",
  "edtech",
  "web_development",
  "productivity",
  "beauty",
  "photography",
  "hr_tech",
  "media",
  "hospitality",
  "gaming",
  "financial_services",
  "wellness",
  "investment",
  "real_estate",
  "proptech",
  "web3",
  "restaurant",
  "insurtech",
  "insurance",
  "nonprofit",
]);
const HUE = z.enum([
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "brown",
]);
const LAYOUT = z.enum([
  "grid_based_strict",
  "asymmetric_broken_grid",
  "generous_whitespace",
  "dense_packed",
  "centered_symmetric",
  "left_aligned_flush",
  "card_based",
  "overlapping_layered",
]);

const ME = z.looseObject({
  user_id: z.string(),
  email: z.string().nullish(),
  role: z.string().nullish(),
});

const SUBMISSION_ACCEPTED = z.looseObject({
  submission_id: z.string(),
  status: SUBMISSION_STATUS,
  source_url: z.string(),
  accepted_at: z.string(),
});

const SUBMISSION = z.looseObject({
  submission_id: z.string(),
  status: SUBMISSION_STATUS,
  source_url: z.string(),
  is_public: z.boolean(),
  kind: SUBMISSION_KIND.optional(),
  current_step: z.string().nullish(),
  step_started_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  accepted_at: z.string().nullish(),
  completed_at: z.string().nullish(),
  cache_hit: z.boolean().optional(),
  extraction_id: z.string().nullish(),
  error: z.string().nullish(),
  credits_consumed: z.number().nullish(),
  batch_id: z.string().nullish(),
  batch_label: z.string().nullish(),
  api_key_name: z.string().nullish(),
  sections: STRING_LIST.nullish(),
});

const SUBMISSION_LIST = z.looseObject({
  submissions: z.array(SUBMISSION),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  totals: z
    .looseObject({
      completed: z.number().optional(),
      failed: z.number().optional(),
      in_progress: z.number().optional(),
    })
    .optional(),
});

const ARTIFACT = z.looseObject({
  path: z.string().optional(),
  url: z.string().optional(),
  content_type: z.string().optional(),
});

// A running job may answer with a partial design_system; status says whether it is final.
const SUBMISSION_RESULT = z.looseObject({
  submission_id: z.string(),
  status: z.string(),
  source_url: z.string(),
  extraction_id: z.string().nullish(),
  current_step: z.string().nullish(),
  step_started_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  result_updated_at: z.string().nullish(),
  accepted_at: z.string().nullish(),
  completed_at: z.string().nullish(),
  cache_hit: z.boolean().optional(),
  sections: STRING_LIST.nullish(),
  result: z
    .looseObject({
      design_system: LOOSE_RECORD.optional(),
      artifacts: z
        .looseObject({
          html: ARTIFACT.optional(),
          css: ARTIFACT.optional(),
          screenshot: ARTIFACT.optional(),
          full_page_screenshot: ARTIFACT.optional(),
          element_layout: ARTIFACT.optional(),
        })
        .optional(),
    })
    .optional(),
});

const SUBMISSION_MANIFEST = z.looseObject({
  submission_id: z.string(),
  extraction_id: z.string().nullish(),
  files: z.array(
    z.looseObject({
      path: z.string(),
      url: z.string().nullish(),
      content: z.string().nullish(),
    })
  ),
});

const ENHANCE_RESPONSE = z.looseObject({
  enhanced_prompt: z.string(),
  brand_name: z.string().nullish(),
  source_url: z.string().optional(),
  model_used: z.string().optional(),
});

const BRAND_SEARCH_CARD = z.looseObject({
  url: z.string(),
  identity_paragraph: z.string(),
  brand_name: z.string().nullish(),
  match: z.enum(["strong", "good", "related"]).nullish(),
  reason: z.string().nullish(),
  badge: z.string().nullish(),
  tags: STRING_LIST.optional(),
  palette: LOOSE_RECORD.nullish(),
  typography: LOOSE_RECORD.nullish(),
  screenshot_url: z.string().nullish(),
});

const BRAND_SEARCH_RESULTS = z.looseObject({
  search_id: z.string().optional(),
  depth: SEARCH_DEPTH.optional(),
  results: z.array(BRAND_SEARCH_CARD).default([]),
  query_tags: z
    .looseObject({
      industry: STRING_LIST.optional(),
      page_type: STRING_LIST.optional(),
      hue: STRING_LIST.optional(),
      aesthetic: STRING_LIST.optional(),
      style: z.string().nullish(),
    })
    .nullish(),
});

const SIMILAR_BRANDS_RESULTS = z.looseObject({
  results: z.array(BRAND_SEARCH_CARD).default([]),
});

// The spec marks nothing required here; an entry without an id is of no use to history.
const SEARCH_SUBMISSION = z.looseObject({
  id: z.string(),
  kind: z.enum(["search", "similar"]).optional(),
  query: z.string().optional(),
  depth: SEARCH_DEPTH.nullish(),
  filters: LOOSE_RECORD.nullish(),
  query_tags: LOOSE_RECORD.nullish(),
  status: z.string().optional(),
  result_count: z.number().nullish(),
  latency_ms: z.number().nullish(),
  credits_consumed: z.number().nullish(),
  api_key_name: z.string().nullish(),
  created_at: z.string().optional(),
  completed_at: z.string().nullish(),
});

const SEARCH_SUBMISSION_LIST = z.looseObject({
  submissions: z.array(SEARCH_SUBMISSION),
  total: z.number().optional(),
  total_by_status: z.record(z.string(), z.number()).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

const ADHERENCE_CACHE_HIT = z.looseObject({
  design_extraction: LOOSE_RECORD.optional(),
  verifier_extraction: LOOSE_RECORD.optional(),
  final_report: z.boolean().optional(),
});

const ADHERENCE_ACCEPTED = z.looseObject({
  job_id: z.string(),
  status: ADHERENCE_STATUS,
  reference_url: z.string(),
  candidate_url: z.string(),
  accepted_at: z.string(),
  is_public: z.boolean().optional(),
  cache_hit: ADHERENCE_CACHE_HIT.optional(),
});

const ADHERENCE_JOB = z.looseObject({
  job_id: z.string(),
  status: ADHERENCE_STATUS,
  reference_url: z.string(),
  candidate_url: z.string(),
  accepted_at: z.string(),
  current_step: z.string().nullish(),
  step_started_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  completed_at: z.string().nullish(),
  is_public: z.boolean().optional(),
  api_key_name: z.string().nullish(),
  error: z.string().nullish(),
  cache_hit: ADHERENCE_CACHE_HIT.optional(),
});

const ADHERENCE_JOB_LIST = z.looseObject({
  jobs: z.array(ADHERENCE_JOB),
  total: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

// A running job may answer with a partial verdict: score null, lists still filling.
const ADHERENCE_VERDICT = z.looseObject({
  job_id: z.string(),
  status: ADHERENCE_STATUS,
  reference_url: z.string(),
  candidate_url: z.string(),
  accepted_at: z.string(),
  completed_at: z.string().nullish(),
  is_public: z.boolean().optional(),
  score: z.number().min(0).max(1).nullable(),
  recommendations: STRING_LIST,
  fixes: z.array(LOOSE_RECORD),
});

export {
  ADHERENCE_ACCEPTED,
  ADHERENCE_JOB,
  ADHERENCE_JOB_LIST,
  ADHERENCE_STATUS,
  ADHERENCE_VERDICT,
  BRAND_KIT_SECTION_NAME,
  BRAND_SEARCH_RESULTS,
  ENHANCE_RESPONSE,
  HUE,
  INDUSTRY,
  LAYOUT,
  ME,
  PAGE_TYPE,
  SEARCH_DEPTH,
  SEARCH_SUBMISSION_LIST,
  SECTION_NAME,
  SIMILAR_BRANDS_RESULTS,
  SUBMISSION,
  SUBMISSION_ACCEPTED,
  SUBMISSION_KIND,
  SUBMISSION_LIST,
  SUBMISSION_MANIFEST,
  SUBMISSION_RESULT,
  SUBMISSION_STATUS,
};
export type {
  AdherenceAccepted,
  AdherenceJob,
  AdherenceJobList,
  AdherenceStatus,
  AdherenceVerdict,
  BrandKitSectionName,
  BrandSearchCard,
  BrandSearchRequest,
  BrandSearchResults,
  EnhanceResponse,
  Me,
  SearchDepth,
  SearchSubmission,
  SearchSubmissionList,
  SectionName,
  SimilarBrandsResults,
  Submission,
  SubmissionAccepted,
  SubmissionCreate,
  SubmissionKind,
  SubmissionList,
  SubmissionManifest,
  SubmissionResult,
  SubmissionStatus,
};
