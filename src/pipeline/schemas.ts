/**
 * Lenient Zod schemas for pipeline stage extraction.
 * Uses .default(), .catch(), and z.coerce to ensure model outputs never crash the parser.
 */
import { z } from 'zod';

// Research stage schemas
export const EvidenceItemSchema = z
  .object({
    chunkId: z.string().default(''),
    quote: z.string().default(''),
    kind: z.enum(['statement', 'request', 'metric', 'competitor_fact', 'goal_signal', 'web_fact']).catch('statement'),
    speaker: z.string().optional().default(''),
    segment: z.string().optional().default(''),
    sentiment: z.enum(['positive', 'neutral', 'negative', 'frustrated']).optional().default('neutral'),
    theme: z.string().optional().default(''),
    metric: z
      .object({
        name: z.string().default(''),
        value: z.coerce.string().default(''),
        period: z.string().optional().default(''),
        trend: z.enum(['up', 'down', 'flat']).optional().default('flat')
      })
      .optional()
  })
  .passthrough();

export const ResearchBatchOutputSchema = z
  .object({
    evidence: z.array(EvidenceItemSchema).default([]),
    goals: z
      .array(
        z.object({
          statement: z.string().default(''),
          metric: z.string().default(''),
          target: z.string().default(''),
          timeframe: z.string().default(''),
          priority: z.coerce.number().catch(1),
          chunkId: z.string().default(''),
          quote: z.string().default('')
        })
      )
      .default([])
  })
  .passthrough();

// Insight stage schema
export const InsightItemSchema = z
  .object({
    title: z.string().default('Untitled Insight'),
    description: z.string().default(''),
    evidenceIds: z.array(z.string()).default([]),
    contradictions: z.array(z.string()).default([])
  })
  .passthrough();

export const InsightStageOutputSchema = z
  .object({
    insights: z.array(InsightItemSchema).default([])
  })
  .passthrough();

// Problem stage schema
export const ProblemItemSchema = z
  .object({
    statement: z.string().default('Untitled Problem'),
    whoAffected: z.string().default('Users'),
    severity: z.coerce.number().catch(3),
    frequency: z.string().default('Frequent'),
    insightIds: z.array(z.string()).default([]),
    evidenceIds: z.array(z.string()).default([]),
    opportunity: z
      .object({
        description: z.string().default(''),
        goalIds: z.array(z.string()).default([])
      })
      .default({ description: '', goalIds: [] })
  })
  .passthrough();

export const ProblemStageOutputSchema = z
  .object({
    problems: z.array(ProblemItemSchema).default([])
  })
  .passthrough();

// Prioritization stage schema
export const PriorityFieldInputSchema = z
  .object({
    value: z.coerce.number().catch(0),
    rationale: z.string().default(''),
    confidence: z.string().default('medium')
  })
  .passthrough();

export const FeatureItemSchema = z
  .object({
    name: z.string().default('Untitled Feature'),
    description: z.string().default(''),
    problemIds: z.array(z.string()).default([]),
    impact: z
      .object({
        goalId: z.string().optional(),
        metric: z.string().default(''),
        direction: z.enum(['increase', 'decrease']).catch('increase'),
        estimate: z.string().default(''),
        assumptions: z.array(z.string()).default([]),
        confidence: z.string().default('medium')
      })
      .default({ metric: '', direction: 'increase', estimate: '', assumptions: [], confidence: 'medium' }),
    inputs: z.record(z.string(), PriorityFieldInputSchema).default({})
  })
  .passthrough();

export const PrioritizationStageOutputSchema = z
  .object({
    features: z.array(FeatureItemSchema).default([])
  })
  .passthrough();

// PRD stage schema
export const RequirementItemSchema = z
  .object({
    featureId: z.string().default(''),
    text: z.string().default(''),
    type: z.enum(['functional', 'non-functional', 'ui', 'integration']).catch('functional'),
    priority: z.enum(['must', 'should', 'could']).catch('must'),
    acceptanceCriteria: z
      .array(
        z.object({
          given: z.string().default(''),
          when: z.string().default(''),
          then: z.string().default('')
        })
      )
      .default([]),
    evidenceIds: z.array(z.string()).default([]),
    problemIds: z.array(z.string()).default([])
  })
  .passthrough();

export const PRDStageOutputSchema = z
  .object({
    title: z.string().default('Product Requirements Document'),
    overview: z.string().default(''),
    problemStatement: z.string().default(''),
    goals: z.array(z.string()).default([]),
    nonGoals: z.array(z.string()).default([]),
    personas: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
    requirements: z.array(RequirementItemSchema).default([]),
    successMetrics: z
      .array(
        z.object({
          metric: z.string().default(''),
          target: z.string().default(''),
          goalId: z.string().optional()
        })
      )
      .default([]),
    risks: z.array(z.string()).default([]),
    openQuestions: z.array(z.string()).default([]),
    dependencies: z.array(z.string()).default([])
  })
  .passthrough();

// Roadmap stage schema
export const RoadmapItemSchema = z
  .object({
    featureId: z.string().default(''),
    horizon: z.enum(['now', 'next', 'later']).catch('later'),
    dependsOn: z.array(z.string()).default([]),
    rationale: z.string().default(''),
    risks: z.array(z.string()).default([])
  })
  .passthrough();

export const RoadmapStageOutputSchema = z
  .object({
    items: z.array(RoadmapItemSchema).default([])
  })
  .passthrough();

// Review stage schema
export const ExecReviewStageOutputSchema = z
  .object({
    verdict: z.enum(['approved', 'needs_work', 'rejected']).catch('needs_work'),
    rubric: z
      .object({
        evidenceStrength: z.object({ score: z.coerce.number().catch(3), note: z.string().default('') }).default({ score: 3, note: '' }),
        strategicFit: z.object({ score: z.coerce.number().catch(3), note: z.string().default('') }).default({ score: 3, note: '' }),
        feasibilityClarity: z.object({ score: z.coerce.number().catch(3), note: z.string().default('') }).default({ score: 3, note: '' }),
        metricQuality: z.object({ score: z.coerce.number().catch(3), note: z.string().default('') }).default({ score: 3, note: '' }),
        riskCoverage: z.object({ score: z.coerce.number().catch(3), note: z.string().default('') }).default({ score: 3, note: '' })
      })
      .default({
        evidenceStrength: { score: 3, note: '' },
        strategicFit: { score: 3, note: '' },
        feasibilityClarity: { score: 3, note: '' },
        metricQuality: { score: 3, note: '' },
        riskCoverage: { score: 3, note: '' }
      }),
    execQuestions: z.array(z.string()).default([]),
    weakestLinks: z.array(z.string()).default([]),
    missingEvidence: z.array(z.string()).default([])
  })
  .passthrough();
