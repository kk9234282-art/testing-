// Complete research instructions supplied for the Search on GPT feature.
const RESEARCH_TEMPLATE = `Act as a professional equity research analyst, business intelligence researcher, and financial educator specializing in Indian listed companies.

I want to deeply understand:

**Company: {COMPANY_NAME}**
**Stock Symbol: {STOCK_SYMBOL}**

My goal is not simply to understand stock prices or financial ratios. I want to understand how this company works as a real business.

Create a detailed, structured, easy-to-understand company research report.

### PART 1 — UNDERSTAND THE BUSINESS

**1. Company Overview**
- What does this company actually do?
- Explain its business in simple language.
- What products or services does it provide?
- Who are its customers?
- Which industries and geographical markets does it serve?

**2. Business Model**
- How does the company earn money?
- Explain its major revenue streams.
- Explain how its operations work step by step.
- What are the company's major expenses?
- Why and how does the company generate profits?
- Give a practical real-world example.

**3. Business Operations**
- Explain the company's core operational processes.
- Identify important assets, infrastructure, technology, or resources.
- Explain how products or services reach customers.
- Identify the most important operational metrics.

**4. Competitive Advantages**
- What makes this company competitive?
- Does it benefit from scale, brand, distribution, technology, network effects, or cost advantages?
- What are its barriers to entry?
- Who are its major competitors?
- How sustainable are its competitive advantages?

**5. Industry Analysis**
- Explain how the industry works.
- Identify important industry trends.
- What determines demand and supply?
- What affects industry profitability?
- What is the company's position within its industry?

**6. Growth Drivers**
- What could drive future revenue growth?
- What expansion projects or investments matter?
- Are there new products, markets, or business opportunities?
- What are the major long-term growth opportunities?

**7. Business Risks**
- What could go wrong?
- Identify operational, financial, regulatory, competitive, and industry risks.
- What external factors could negatively affect profitability?
- Explain the most important risks in simple language.

### PART 2 — UNDERSTAND THE STOCK

**8. Financial Performance**
Analyze available historical trends in:
- Revenue
- Net profit
- Operating margins
- Cash flow
- Debt
- Return on equity
- Return on capital employed
- Capital expenditure

Explain what these numbers reveal about the underlying business.

**9. Valuation**
- Explain the company's valuation.
- Analyze relevant valuation ratios.
- Compare valuation with appropriate competitors.
- Explain which factors could justify a premium or discount.

**10. Company-Specific Metrics**

This section is extremely important.

Do not use the same analysis framework for every company.

Identify the company's industry and select the operational and financial metrics that genuinely matter.

Examples:

For ports and logistics companies:
- Cargo volumes
- Port capacity
- Capacity utilization
- Logistics network
- Revenue per tonne

For banks:
- Deposits and advances
- Net interest margin
- CASA ratio
- Gross and net NPAs
- Credit costs

For steel companies:
- Production capacity
- Steel volumes
- Realizations
- Raw material costs
- EBITDA per tonne

For pharmaceutical companies:
- Drug portfolio
- R&D pipeline
- Regulatory approvals
- Geographic revenue mix

For IT services companies:
- Client industries
- Deal wins
- Employee utilization
- Attrition
- Operating margins

For consumer companies:
- Distribution network
- Market share
- Volume growth
- Pricing power
- Raw material costs

Adapt the research framework intelligently to the selected company's actual business.

**11. What Investors Should Monitor**
- Identify the 5–10 most important business and financial metrics.
- Explain why each metric matters.
- Explain what improving or deteriorating trends might indicate.

**12. Final Business Summary**
Provide a clear summary covering:
- How the business makes money
- What makes it competitive
- What drives growth
- Major risks
- Financial strengths and weaknesses
- What investors should watch going forward

### RESEARCH QUALITY REQUIREMENTS

1. Use clear, beginner-friendly English without sacrificing analytical depth.
2. Provide real-world examples wherever helpful.
3. Use tables, diagrams, and visual explanations when useful.
4. Use relevant financial figures with reporting periods.
5. Prioritize annual reports, investor presentations, stock exchange filings, and official company disclosures.
6. Cite reliable sources and distinguish verified facts from interpretation.
7. Use the latest available information when browsing is available.
8. Do not invent numbers, financial metrics, or future projections.
9. Clearly state when information is unavailable or cannot be verified.
10. Avoid generic explanations that could apply to any company.
11. Adapt the analysis to the company's actual industry and business model.
12. This is educational business research, not a personalized buy or sell recommendation.

The final result should feel like a professional company research report that helps someone genuinely understand the business behind the stock.`;

const text = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

// Only public company identity fields are included; no quotes, holdings or credentials.
export function buildCompanyResearchPrompt(company = {}) {
  if (!company || typeof company !== "object") return null;
  const name = text(company.name);
  const id = text(company.id);
  const listing = /^(NSE|BSE):(.+)$/.exec(id);
  const exchange = ["NSE", "BSE"].includes(text(company.exchange).toUpperCase())
    ? text(company.exchange).toUpperCase()
    : listing?.[1] || "";
  const symbol = text(company.symbol) || listing?.[2] || "";
  if (!name && !symbol) return null;
  const stockSymbol = symbol
    ? `${exchange ? exchange + ":" : ""}${symbol}`
    : "Unavailable — verify the NSE/BSE ticker before researching";
  const companyName =
    name ||
    `${stockSymbol} (company name unavailable — verify the issuer’s legal name)`;
  // Callback replacements keep literal $&, $` and other characters in company names.
  const prompt = RESEARCH_TEMPLATE.replace(
    /\{COMPANY_NAME\}|\{STOCK_SYMBOL\}/g,
    (placeholder) =>
      placeholder === "{COMPANY_NAME}" ? companyName : stockSymbol,
  );

  const context = [
    exchange && `Exchange: ${exchange}`,
    id && `Listing ID: ${id}`,
    text(company.isin) && `ISIN: ${text(company.isin)}`,
    text(company.sector) && `Reported sector: ${text(company.sector)}`,
    text(company.industry) && `Reported industry: ${text(company.industry)}`,
  ].filter(Boolean);
  return context.length
    ? `${prompt}\n\nAdditional public listing context:\n${context.join("\n")}`
    : prompt;
}
