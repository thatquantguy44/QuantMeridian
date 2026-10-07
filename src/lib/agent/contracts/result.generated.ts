/* eslint-disable */
/**
 * GENERATED from contracts/agent/result.schema.json by scripts/generate-agent-contracts.mjs.
 * Do not edit by hand; run `npm run generate:agent-contracts`.
 */

/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "Block".
 */
export type Block =
  | ChartBlock
  | PlanEchoBlock
  | InsightsBlock
  | NarrativeBlock
  | TableBlock
  | ClarificationBlock
  | CaveatsBlock
  | NoticeBlock;
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "Claim".
 */
export type Claim =
  | LevelClaim
  | DeltaClaim
  | TransformPointClaim
  | WindowStatClaim
  | LatestDateClaim
  | AggregateClaim
  | AssumptionClaim
  | CalculatedClaim;
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "ClaimRef".
 */
export type ClaimRef = string;

/**
 * Result payload a worker writes for a job (agent-result/1). It carries no verdict: verification is written only by the Node verifier.
 */
export interface AgentResult {
  schema_version: "agent-result/1";
  job_id: string;
  workflow: {
    id: "chart.build" | "analysis.answer" | "secfin.carry" | "story.build" | "brief.draft";
    version: string;
    kind: ("macro_backdrop" | "funding_conditions" | "desk_review") | null;
  };
  outcome: "answered" | "clarification" | "unsupported_chart" | "unsupported_metric" | "data_unavailable";
  /**
   * @maxItems 60
   */
  blocks: Block[];
  /**
   * @maxItems 2000
   */
  claims: Claim[];
  disclosure: Disclosure;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  timings_ms?: {
    [k: string]: number;
  };
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "ChartBlock".
 */
export interface ChartBlock {
  type: "chart";
  title?: string;
  chart: {
    range: "1M" | "3M" | "6M" | "1Y" | "2Y" | "5Y" | "MAX";
    transform: "none" | "index100" | "pct_change" | "yoy" | "mom" | "zscore" | "log";
    /**
     * @minItems 1
     * @maxItems 8
     */
    series:
      | [
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          }
        ]
      | [
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          }
        ]
      | [
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          }
        ]
      | [
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          }
        ]
      | [
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          }
        ]
      | [
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          }
        ]
      | [
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          }
        ]
      | [
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          },
          {
            ref: SeriesRef;
            chartType: "line" | "area";
          }
        ];
  };
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "SeriesRef".
 */
export interface SeriesRef {
  source: "econ" | "fred" | "market" | "lens";
  id: string;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "PlanEchoBlock".
 */
export interface PlanEchoBlock {
  type: "plan_echo";
  items: {
    metric: string;
    label: string;
    window?: string;
    grain?: "day" | "week" | "month" | "quarter" | "year";
    transform?: "none" | "index100" | "pct_change" | "yoy" | "mom" | "zscore" | "log";
    [k: string]: unknown;
  }[];
  notes?: string[];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "InsightsBlock".
 */
export interface InsightsBlock {
  type: "insights";
  items: {
    kind: string;
    text_template: string;
    authored_by: "template" | "llm";
    template_fallback?: string;
    claims?: string[];
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "NarrativeBlock".
 */
export interface NarrativeBlock {
  type: "narrative";
  heading?: string;
  text_template: string;
  authored_by: "template" | "llm";
  template_fallback?: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "TableBlock".
 */
export interface TableBlock {
  type: "table";
  title?: string;
  /**
   * @minItems 1
   * @maxItems 12
   */
  columns:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string];
  /**
   * @maxItems 200
   */
  rows:
    | []
    | [
        | {
            text: string;
          }
        | {
            claim: string;
          }
      ]
    | [
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        )
      ]
    | [
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        )
      ]
    | [
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        )
      ]
    | [
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        )
      ]
    | [
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        )
      ]
    | [
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        )
      ]
    | [
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        )
      ]
    | [
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        )
      ]
    | [
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        )
      ]
    | [
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        )
      ]
    | [
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        ),
        (
          | {
              text: string;
            }
          | {
              claim: string;
            }
        )
      ][];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "ClarificationBlock".
 */
export interface ClarificationBlock {
  type: "clarification";
  reason: string;
  question?: string;
  /**
   * @maxItems 20
   */
  candidates?:
    | []
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ]
    | [
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        },
        {
          id: string;
          label?: string;
          [k: string]: unknown;
        }
      ];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "CaveatsBlock".
 */
export interface CaveatsBlock {
  type: "caveats";
  items: {
    id: string;
    source: string;
    text: string;
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "NoticeBlock".
 */
export interface NoticeBlock {
  type: "notice";
  code: string;
  text_template: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "LevelClaim".
 */
export interface LevelClaim {
  id: string;
  kind: "level";
  provenance: "DB";
  series: SeriesRef;
  date: string;
  value: number;
  unit: "pct" | "pp" | "bps" | "index" | "currency" | "count" | "ratio" | "hours" | "days" | "shares";
  decimals: number;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "DeltaClaim".
 */
export interface DeltaClaim {
  id: string;
  kind: "delta";
  provenance: "DB";
  series: SeriesRef;
  from: string;
  to: string;
  basis: "abs" | "bps" | "pct";
  value: number;
  unit: "pct" | "pp" | "bps" | "index" | "currency" | "count" | "ratio" | "hours" | "days" | "shares";
  decimals: number;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "TransformPointClaim".
 */
export interface TransformPointClaim {
  id: string;
  kind: "transform_point";
  provenance: "DB";
  series: SeriesRef;
  date: string;
  transform: "yoy" | "mom" | "pct_change" | "log";
  value: number;
  unit: "pct" | "pp" | "bps" | "index" | "currency" | "count" | "ratio" | "hours" | "days" | "shares";
  decimals: number;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "WindowStatClaim".
 */
export interface WindowStatClaim {
  id: string;
  kind: "window_stat";
  provenance: "DB";
  series: SeriesRef;
  from: string;
  to: string;
  stat: "min" | "max" | "mean" | "first" | "last" | "count";
  at?: string | null;
  value: number;
  unit: "pct" | "pp" | "bps" | "index" | "currency" | "count" | "ratio" | "hours" | "days" | "shares";
  decimals: number;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "LatestDateClaim".
 */
export interface LatestDateClaim {
  id: string;
  kind: "latest_date";
  provenance: "DB";
  series: SeriesRef;
  date: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "AggregateClaim".
 */
export interface AggregateClaim {
  id: string;
  kind: "aggregate";
  provenance: "SIM";
  dataset: string;
  metric: string;
  filters?: {
    [k: string]: string | number;
  };
  group?: {
    [k: string]: string | number;
  } | null;
  value: number;
  unit: "pct" | "pp" | "bps" | "index" | "currency" | "count" | "ratio" | "hours" | "days" | "shares";
  decimals: number;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "AssumptionClaim".
 */
export interface AssumptionClaim {
  id: string;
  kind: "assumption";
  provenance: "USER";
  name: string;
  value: number | string | boolean;
  unit?: "pct" | "pp" | "bps" | "index" | "currency" | "count" | "ratio" | "hours" | "days" | "shares";
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "CalculatedClaim".
 */
export interface CalculatedClaim {
  id: string;
  kind: "calculated";
  formula:
    | "days_act"
    | "leg_cost"
    | "net_financing_cost"
    | "funding_rate_bps"
    | "shocked_net_cost"
    | "pct_to_bps"
    | "spread_bps"
    | "share";
  inputs: string[];
  params?: {};
  value: number;
  unit: "pct" | "pp" | "bps" | "index" | "currency" | "count" | "ratio" | "hours" | "days" | "shares";
  decimals?: number;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `AgentResult`'s JSON-Schema
 * via the `definition` "Disclosure".
 */
export interface Disclosure {
  quantsmith: {
    mode: "path" | "installed";
    code_digest: string;
    assets_digest: string;
    [k: string]: unknown;
  };
  registry_version: string;
  interpreter_mode: "form" | "keyword" | "llm";
  llm: {
    profile: string;
    provider?: string;
    model: string;
    use: "copilot" | "interpreter" | "narrator" | "drafter";
    input_tokens?: number;
    output_tokens?: number;
    [k: string]: unknown;
  }[];
  prompts: {
    id: string;
    version: string;
    sha256: string;
    [k: string]: unknown;
  }[];
  plans_sha256: string[];
  data: {
    series?: SeriesRef;
    dataset?: string;
    as_of: string;
    rows: number;
    provenance: "DB" | "SIM";
    [k: string]: unknown;
  }[];
  content_hash: string;
  packs?: {
    id: string;
    kind: string;
    review_status: string;
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}
