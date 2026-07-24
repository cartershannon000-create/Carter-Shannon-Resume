# AI Drives EBITDA Deck Restructure Plan

## Purpose

Restructure the `AI Drives EBITDA, but Requires a Strong Strategy` deck so the story is easier to follow, the opportunity is established before the execution barriers are introduced, and the offer feels like the logical conclusion of the evidence.

This document is intended as an implementation handoff for Claude.

## Source Deck

- Deck: `decks/pe-ai-ebitda-strategy/index.html`
- Format: self-contained HTML presentation
- Existing slide IDs: `s1` through `s18`
- Preserve the existing CS Ventures visual system unless a layout must change to support the revised content.

## Core Story

The revised deck should make one forward-moving argument:

> PE believes AI can create value → the unrealized opportunity is large → execution is stalled → an integrated builder-operator model solves the problem → a single-portco diagnostic is the logical starting point.

The current deck moves from the gap to the value opportunity, then to proof, then back to execution barriers. This makes the audience reopen the problem after it has already begun considering the solution.

The revised sequence should establish:

1. What PE already believes.
2. What value remains unrealized.
3. Why PE firms and portfolio companies have not captured it.
4. What operating model is required.
5. Why CS Ventures can deliver it.
6. How a buyer can start.

## Terminology Changes

Make the following changes throughout the deck:

- Rename **The Gap** to **The Opportunity**.
- Rename **The Proof** to **Why Execution Stalls** or distribute its proof slides into the relevant sections.
- Rename **The Wedge** to **The Execution Model**.
- Rename **The Offer** to **How We Start**.
- Replace audience-facing descriptions of PE firms as "confused" with:
  - **High conviction, low execution clarity**
  - **Convinced of the value, but uncertain how to operationalize it**
- Avoid using "wedge" in external-facing content.

## Revised Core Deck

Target a core deck of approximately 13 slides. A 14th slide is acceptable if the CS Ventures proof cannot be presented clearly on one slide.

### Slide 1 — Cover

**Existing source:** `s1`

**Recommended title:**

> From AI Conviction to EBITDA

**Recommended subtitle:**

> An execution model for PE-backed portfolio companies

**Supporting line:**

> Strategy, build, adoption, and measurement in one operating loop.

The existing title, `AI Drives EBITDA, but Requires a Strong Strategy`, overemphasizes strategy. The deck's actual thesis is that strategy, technical execution, operator judgment, adoption, and measurement must work together.

### Slide 2 — Executive Summary

**Existing source:** `s3`

This must be the first slide after the cover.

**Recommended headline:**

> PE Has AI Conviction—but the Execution Gap Closes Only When Builder and Operator Fluency Sit in the Same Engagement

Use a simple four-part structure:

1. **Conviction**
   - 84% of PE funds expect AI to transform portfolio value.
2. **Unrealized opportunity**
   - Only 7% have reached enterprise-scale deployment.
3. **Why execution stalls**
   - Talent, data readiness, and time-to-value are the leading barriers.
4. **What closes the gap**
   - Technical fluency ships the build.
   - Operator fluency connects it to EBITDA.
   - Adoption discipline changes how work is actually performed.

**Bottom-band conclusion:**

> The opportunity is not convincing PE that AI matters. It is giving portfolio companies a repeatable way to convert that conviction into measured EBITDA.

Include the single-portco diagnostic as the ask, but keep it subordinate to the thesis.

### Slide 3 — The Two Value Engines

**Existing source:** `s6`

**Keep the current headline:**

> AI Value Splits Into Two Engines: Efficiency Gains That Protect Margin and Opportunity Gains That Change the Growth Story

Clarify the definitions:

- **Efficiency gains:** perform existing work faster, cheaper, or more accurately.
- **Opportunity gains:** create capabilities the portfolio company could not previously support economically.

Opportunity examples should include:

- Continuous risk and customer surveillance
- Predictive retention and expansion
- Enterprise-grade account intelligence at SMB economics
- Faster product development
- New AI-enabled products or revenue models

This definition is important because the portfolio risk-surveillance example is a new capability, but it is not directly a new revenue stream.

### Slide 4 — At-Scale AI Proof

**New slide**

**Recommended headline:**

> At Scale, AI Changes the Operating Model—not Just Individual Tasks

Use Replit as a concise example of what happens when AI is integrated across a company rather than deployed as isolated tools.

Feature four metrics:

- **2.9×** code output per engineer for a consistent cohort
- **30%** of human pull-request review time saved, with review latency remaining flat
- **60% faster** resolution of the hardest support tickets
- A **seven-figure SaaS product eliminated** after an internally built system outperformed it

**Supporting takeaway:**

> These results did not come from giving employees another chatbot. Replit connected agents to company systems, trusted data, permissions, playbooks, verification loops, and human escalation.

**Source note:**

> Source: Replit, "The Self-Driving Company," July 16, 2026. Metrics are company-reported and should not be presented as independently validated EBITDA impact.

Source URL:

`https://replit.com/blog/self-driving-company`

### Slide 5 — Opportunity Use Case

**Existing source:** `s9`

**Keep the current headline:**

> Opportunity Gains Turn Periodic, Reactive Portfolio Review Into Continuous, Proactive Risk Surveillance

Keep the before-and-after structure.

Clarify that the opportunity is the ability to provide enterprise-grade surveillance at SMB headcount and economics.

If possible, add a short KPI row:

- Signal detection lead time
- Analyst hours required
- Percentage of portfolio continuously monitored
- Risks surfaced before P&L impact
- Management actions triggered

Do not invent results if these metrics are not available. Use them as measurement categories unless supported by client data.

### Slide 6 — Valuation Implication

**Existing source:** `s10`

Keep the underlying McKinsey exhibit, but revise the language to avoid implying causation.

**Recommended headline:**

> Higher AI Maturity Is Associated With Median Revenue Multiples Rising From 14× to 31×

Use:

> Portfolio companies move from operating enhancement to product transformation and business building.

Avoid:

> AI causes revenue multiples to rise from 14× to 31×.

Retain the methodology and sample footnote.

### Slide 7 — Why Execution Stalls

**Existing source:** `s11`

**Keep the current headline:**

> Talent Shortage, Data Readiness, and Time-to-Value Are the Top Three Barriers Keeping AI Stuck in Pilot Mode

This slide should appear immediately after the Opportunity section. It explains why the value shown in Slides 3–6 remains unrealized.

End with:

> PE does not have an AI-awareness problem. It has an operating-model problem.

### Slide 8 — The Capability Requirement

**Existing source:** `s13`

Replace the adversarial headline about big consulting and tech shops.

**Recommended headline:**

> The Market Splits Strategy, Build, and Adoption Across Providers—AI-to-EBITDA Requires All Three in One Loop

Recommended columns:

- Strategy-led advisor
- Build-led technology partner
- Integrated builder-operator

Recommended capability rows:

- Business and EBITDA framing
- Technical build fluency
- Workflow and operating-model redesign
- Frontline adoption
- KPI baselining and measurement
- Governance and scale

The current matrix is explicitly illustrative. Avoid presenting generalized provider weaknesses as independently researched facts.

The point of the slide should be:

> The engagement fails if strategy, build, adoption, and measurement are split across disconnected owners.

### Slide 9 — The Execution Model

**New slide**

**Recommended headline:**

> One Operating Loop Connects AI Strategy to Measured EBITDA

Show a six-stage loop:

1. **Prioritize**
   - Select workflows based on value, feasibility, and verifiability.
2. **Baseline**
   - Establish current cost, cycle time, quality, revenue, and risk metrics.
3. **Connect**
   - Provide governed access to systems, knowledge, and trusted data.
4. **Build**
   - Encode the workflow, decision rules, tools, and human escalation.
5. **Adopt**
   - Embed the system in the tools and routines employees already use.
6. **Measure and scale**
   - Compare results with the baseline and expand only when the economics hold.

Add a governance rail across the entire loop:

- Permissions
- Audit logs
- Data controls
- Human approval thresholds
- Quality evaluation
- Cost monitoring

### Slide 10 — CS Ventures Proof

**Existing sources:** `s8` and `s14`

Consolidate the current deck-agent slide and four-build table.

**Recommended headline:**

> Four Live Builds Demonstrate the Builder-Operator Model Across Efficiency and Opportunity Workflows

Use consistent case-study fields:

- Client or company context
- Workflow
- Previous baseline
- What was built
- Adoption method
- Measured result

Retain the current quantified proof:

- Board-deck production reduced from one week to two hours

For the other builds, add quantified measures only if they can be supported. If exact measures are unavailable, clearly distinguish:

- Quantified results
- Operational outcomes
- Capabilities demonstrated

Do not use "prove" when the row contains no measurable outcome. In that case use "demonstrate."

### Slide 11 — Diagnostic Deliverables

**New slide**

**Recommended headline:**

> In 30–60 Days, a Single-Portco Diagnostic Produces a Fundable AI-to-EBITDA Roadmap

Show the actual outputs:

- Efficiency and opportunity value map
- Prioritized use-case portfolio
- Current-state KPI baselines
- Data and integration readiness assessment
- Workflow and adoption assessment
- Business case and return model
- Build-versus-buy recommendations
- Governance and risk requirements
- Two quick-win build specifications
- Two strategic redesign opportunities
- 90-day implementation roadmap

The purpose of this slide is to make the initial purchase tangible.

### Slide 12 — Engagement Path

**Existing source:** `s17`

Replace five parallel engagement models with a three-phase progression:

#### Phase 1 — Diagnose

- 30–60 days
- Identify and prioritize the highest-value efficiency and opportunity gains
- Establish baselines and implementation requirements

#### Phase 2 — Build and Adopt

- Ship two quick wins and one or two strategic workflow redesigns
- Embed them in real operating routines
- Train users and measure results

#### Phase 3 — Scale

- Expand across functions, portfolio companies, or the fund
- Standardize governance, KPIs, shared components, and board reporting
- Pursue AI-enabled products and business-building opportunities where appropriate

AI product and business-building strategy can be shown as a strategic workstream within Phase 3 rather than as a fifth unrelated engagement model.

### Slide 13 — Close

**Existing source:** `s18`

**Recommended headline:**

> Turn AI Conviction Into a Measured EBITDA Lever, Starting With One Portfolio Company

Use three concise takeaways:

1. PE conviction is high, but enterprise-scale execution remains rare.
2. The opportunity includes both margin protection and capabilities that change the growth and exit story.
3. Capturing that value requires strategy, build, adoption, governance, and measurement in one operating loop.

**CTA:**

> Select one portfolio company for a 30–60-day AI-to-EBITDA diagnostic.

Specify the immediate next step:

- Select the portfolio company.
- Identify an executive sponsor.
- Schedule a data and workflow scoping session.

## Slides to Delete, Merge, or Move

### Delete From the Core Deck

- `s2` — Agenda
  - A 13-slide deck does not need an agenda.
- `s4` — The Gap divider
  - Replace with the Opportunity section label on Slide 3.
- `s5` — Standalone 84% versus 7% slide
  - Merge its metrics into the executive summary.
- `s7` — The Proof divider
  - The proof should appear alongside the claim it supports.
- `s12` — The Wedge divider
  - Replace with The Execution Model section treatment.
- `s16` — The Offer divider
  - Move directly from proof and execution into how the engagement starts.

### Merge

- Merge `s8` and `s14` into the revised CS Ventures proof slide.

### Move to Appendix or Speaker Narrative

- `s15` — First-client manifesto
  - The founder story can be useful in conversation, but it is weaker than quantified client evidence in the main deck.

### Rewrite

- `s13` — Competitor matrix
  - Reframe around capability integration, not unsupported provider criticism.
- `s17` — Five engagement models
  - Convert to a three-phase engagement path.
- `s18` — Closing slide
  - Remove repeated statistics and end with one concrete next step.

## Replit Appendix

Add five appendix slides. These should provide detailed evidence without slowing the main deck.

### Appendix A1 — Measurable Outcomes

**Headline:**

> Replit Nearly Tripled Output per Engineer Without Creating a Quality or Review Bottleneck

Show:

- 2.9× code output for a consistent employee cohort
- 5.8× total lines of code contributed from early January through late June
- 30% of human pull-request review time saved
- Review latency remained flat
- Reversion and product-incident trends remained flat
- Mean time to mitigation declined
- Project completion increased
- Hardest support tickets resolved 60% faster

Clearly label all figures as self-reported by Replit.

### Appendix A2 — How the System Works

**Headline:**

> The Gain Came From a Governed Agent Operating System, Not a Standalone AI Tool

Recommended flow:

> Employee sets the outcome → manager agent decomposes the work → specialist agents act across systems → outputs are evaluated → exceptions escalate to people → results improve the next cycle

System components:

- Manager agent capable of spawning multiple agents
- Verifiable agent loops
- Connections to operating systems and knowledge bases
- Remote and isolated execution infrastructure
- Function-specific skills and playbooks
- Trusted data and semantic definitions
- Human escalation for judgment and accountability

Controls:

- Access policies
- Token proxies
- Audit logging
- Zero-trust network
- Approval thresholds
- Security and cost controls

### Appendix A3 — Why Adoption Spread

**Headline:**

> Adoption Accelerated Because AI Entered Existing Workflows and Used Trusted Company Context

Key mechanisms:

- A Slack interface made the system visible and accessible.
- Employees could ask questions and then take follow-up actions.
- Connections to internal systems made outputs company-specific.
- A semantic layer identified trusted data and relationships.
- Teams contributed their own skills and integrations.
- Human escalation preserved judgment and accountability.
- Visible wins encouraged additional teams to participate.

### Appendix A4 — Translation to Non-Code Companies

**Headline:**

> The Model Transfers When Software Code Is Replaced With a Verifiable Business Work Product

| Function | Example work product | Verification method | Primary economic KPI |
|---|---|---|---|
| Finance | Reconciliation, collections prioritization, close package | Ledger checks and controller approval | Close time, DSO, finance cost |
| Customer service | Ticket investigation and proposed resolution | Policy checks and escalation rules | Cost per ticket, resolution time |
| Sales | Account research, next-best action, proposal | CRM evidence and manager approval | Rep capacity, conversion, retention |
| Procurement | Vendor comparison and contract intake | Policy, pricing, and legal thresholds | Spend avoided, cycle time |
| Field operations | Schedule, exception detection, work-order follow-up | SLA and supervisor checks | Utilization, rework, response time |
| Portfolio operations | Risk scan and management alert | Source citations and operating-partner review | Detection lead time, loss avoided |

Do not imply that non-code companies will reproduce Replit's exact productivity gains. The transferable lesson is the operating pattern.

### Appendix A5 — Portco Implementation Plan

**Headline:**

> A Portfolio Company Can Prove the Model in 90 Days, Starting With One High-Volume, Verifiable Workflow

#### Days 0–15 — Select and Baseline

- Choose a high-volume workflow with a measurable output.
- Establish cost, time, quality, revenue, and risk baselines.
- Identify systems, data, owners, and approval requirements.

#### Days 16–45 — Connect and Pilot

- Connect the minimum required systems and knowledge.
- Encode the workflow and standard operating procedure.
- Define quality tests and escalation rules.
- Launch with a controlled user group.

#### Days 46–75 — Measure and Harden

- Measure economics, quality, adoption, and exception rates.
- Add permissions, logging, monitoring, and cost controls.
- Improve the workflow using observed failures.

#### Days 76–90 — Scale Decision

- Compare results with the baseline.
- Decide whether to scale, redesign, or stop.
- Document reusable components and rollout requirements.

Primary decision metrics should be:

- Hours eliminated or redeployed
- Cycle-time reduction
- Error-rate reduction
- Revenue captured or retained
- Risk detected earlier
- Adoption and override rates
- AI and infrastructure cost per completed work item

Avoid using prompt volume or tool-login counts as primary value metrics.

## Source and Claims Guidance

### Replit

Primary source:

`https://replit.com/blog/self-driving-company`

Use careful attribution:

- "Replit reports..."
- "Company-reported data show..."
- "In Replit's internal deployment..."

Do not state:

- That the results were independently verified
- That Replit produced a specific EBITDA gain
- That another portfolio company should expect the same magnitude
- That the reported gains were caused by one tool alone

### McKinsey Multiple Data

Use association language:

- "Higher AI maturity is associated with..."
- "Median multiples increase across the maturity levels in McKinsey's sample..."

Do not use direct causation language.

### CS Ventures Proof

Every proof point should be classified as one of:

- Quantified result
- Operational outcome
- Capability demonstrated

Do not present an operational description as a quantified financial result.

## Design Guidance

- Preserve the existing dark-green and cream CS Ventures visual system.
- Use no more than one primary message per slide.
- Keep action titles conclusion-led.
- Avoid more than four primary content blocks per slide.
- Use section tabs instead of standalone divider slides where possible.
- Make the core deck readable without the appendix.
- Use the appendix for architecture, implementation detail, and supporting metrics.
- Keep source notes legible and specific.
- Use consistent terminology for the two value engines throughout.
- Avoid placing the same market statistic on multiple consecutive slides.

## Implementation Requirements

When restructuring the HTML:

1. Preserve working keyboard navigation, shot mode, and print mode.
2. Renumber slide IDs and visible page numbers consistently.
3. Update section tabs to match the new section names.
4. Remove unused slide-specific CSS after slides are deleted or merged.
5. Add slide-specific CSS for the Replit teaser, execution loop, diagnostic deliverables, and appendix.
6. Keep the deck at 1280 × 720 with no content overflow.
7. Validate every slide in both normal presenter mode and `?print=1`.
8. Check that every factual claim has an appropriate source note.
9. Do not invent client metrics or Replit results.
10. Ensure the deck works without requiring a build step.

## Completion Criteria

The restructure is complete when:

- The executive summary is the first slide after the cover.
- The section formerly called The Gap is now The Opportunity.
- The deck follows the opportunity → barriers → execution model → proof → offer sequence.
- The standalone agenda and most divider slides are removed.
- Replit appears as a concise core-deck proof point and a five-slide appendix case study.
- Replit's implementation pattern is translated to non-code portfolio companies.
- The engagement offer is presented as Diagnose → Build and Adopt → Scale.
- The 30–60-day diagnostic has concrete deliverables.
- The final slide contains one clear next step.
- The main deck is approximately 13–14 slides before the appendix.
- All slides render without clipping or overflow.

