// The Taste Engine's answers (docs/superpowers/reference/openapi.json), listing only the fields
// taste-cli reads. Objects are loose, so everything else passes through untouched to --json and a
// field Taste adds later never breaks the CLI. The strict enums are for what a person types.
import { z } from "zod";

type SectionName = z.infer<typeof SECTION_NAME>;
type SubmissionStatus = z.infer<typeof SUBMISSION_STATUS>;
type AdherenceStatus = z.infer<typeof ADHERENCE_STATUS>;
type SearchStatus = z.infer<typeof SEARCH_STATUS>;
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
  depth?: "fast" | "deep";
  top_k?: number;
  filters?: {
    page_type?: z.infer<typeof PAGE_TYPE> | null;
    industry?: z.infer<typeof INDUSTRY> | null;
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
const SUBMISSION_STATUS = z.enum([
  "accepted",
  "queued",
  "crawling",
  "extracting",
  "completed",
  "failed",
]);
const ADHERENCE_STATUS = z.enum([
  "accepted",
  "extracting",
  "judging",
  "completed",
  "failed",
]);
// The outcomes the search history filters by (GET /search/submissions?status=).
const SEARCH_STATUS = z.enum(["completed", "failed", "in_progress"]);
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

const ME = z.looseObject({ email: z.string().nullish() });

// A status in an answer takes any string: one Taste adds later must never turn a paid answer or a
// whole list page into an error.
const SUBMISSION_ACCEPTED = z.looseObject({
  submission_id: z.string(),
  status: z.string(),
});

const SUBMISSION = z.looseObject({
  submission_id: z.string(),
  status: z.string(),
  source_url: z.string(),
  is_public: z.boolean().optional(),
  kind: z.string().optional(),
  current_step: z.string().nullish(),
  accepted_at: z.string().nullish(),
  error: z.string().nullish(),
  sections: STRING_LIST.nullish(),
});

const SUBMISSION_LIST = z.looseObject({
  submissions: z.array(SUBMISSION),
  total: z.number(),
});

// A running job may answer with a partial design_system; the job's status says whether it is final.
const SUBMISSION_RESULT = z.looseObject({
  submission_id: z.string(),
  source_url: z.string(),
  cache_hit: z.boolean().optional(),
  result: z.looseObject({ design_system: LOOSE_RECORD.optional() }).optional(),
});

const SUBMISSION_MANIFEST = z.looseObject({
  submission_id: z.string(),
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
});

// Taste publishes no shape for palette, so it stays a record.
const BRAND_SEARCH_CARD = z.looseObject({
  url: z.string(),
  identity_paragraph: z.string(),
  brand_name: z.string().nullish(),
  match: z.string().nullish(),
  reason: z.string().nullish(),
  badge: z.string().nullish(),
  tags: STRING_LIST.optional(),
  palette: LOOSE_RECORD.nullish(),
});

const BRAND_SEARCH_RESULTS = z.looseObject({
  results: z.array(BRAND_SEARCH_CARD).default([]),
});

const SIMILAR_BRANDS_RESULTS = z.looseObject({
  results: z.array(BRAND_SEARCH_CARD).default([]),
});

// The spec marks nothing required here; an entry without an id is of no use to history.
const SEARCH_SUBMISSION = z.looseObject({
  id: z.string(),
  query: z.string().optional(),
  status: z.string().optional(),
  created_at: z.string().optional(),
});

const SEARCH_SUBMISSION_LIST = z.looseObject({
  submissions: z.array(SEARCH_SUBMISSION),
  total: z.number().optional(),
});

const ADHERENCE_ACCEPTED = z.looseObject({
  job_id: z.string(),
  status: z.string(),
});

const ADHERENCE_JOB = z.looseObject({
  job_id: z.string(),
  status: z.string(),
  reference_url: z.string(),
  candidate_url: z.string(),
  accepted_at: z.string(),
  current_step: z.string().nullish(),
  is_public: z.boolean().optional(),
  error: z.string().nullish(),
});

const ADHERENCE_JOB_LIST = z.looseObject({
  jobs: z.array(ADHERENCE_JOB),
  total: z.number().optional(),
});

// A running job may answer with a partial verdict: score null, lists still filling. Taste publishes
// no shape for a fix, so each stays a record.
const ADHERENCE_VERDICT = z.looseObject({
  job_id: z.string(),
  reference_url: z.string(),
  candidate_url: z.string(),
  // 0 to 1 by the spec; not enforced, so a change of scale shows rather than fails.
  score: z.number().nullable(),
  recommendations: STRING_LIST,
  fixes: z.array(LOOSE_RECORD),
});

export {
  ADHERENCE_ACCEPTED,
  ADHERENCE_JOB,
  ADHERENCE_JOB_LIST,
  ADHERENCE_STATUS,
  ADHERENCE_VERDICT,
  BRAND_SEARCH_RESULTS,
  ENHANCE_RESPONSE,
  INDUSTRY,
  ME,
  PAGE_TYPE,
  SEARCH_STATUS,
  SEARCH_SUBMISSION_LIST,
  SECTION_NAME,
  SIMILAR_BRANDS_RESULTS,
  SUBMISSION,
  SUBMISSION_ACCEPTED,
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
  BrandSearchCard,
  BrandSearchRequest,
  BrandSearchResults,
  EnhanceResponse,
  Me,
  SearchStatus,
  SearchSubmission,
  SearchSubmissionList,
  SectionName,
  SimilarBrandsResults,
  Submission,
  SubmissionAccepted,
  SubmissionCreate,
  SubmissionList,
  SubmissionManifest,
  SubmissionResult,
  SubmissionStatus,
};
