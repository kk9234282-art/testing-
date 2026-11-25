// Deliberately fictional, only used while the user selects Sample data.
export function sampleResearch(company, section) {
  const candles = Array.from({ length: 60 }, (_, i) => {
    const time = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
    const open = company.price * (1 + Math.sin(i * 0.3) * 0.03),
      close = open * (1 + Math.cos(i * 0.4) * 0.01);
    return {
      time,
      open,
      close,
      high: Math.max(open, close) * 1.01,
      low: Math.min(open, close) * 0.99,
      volume: 100000 + i * 1000,
    };
  });
  const dividends = [
    {
      exDate: candles[35].time,
      amount: 5,
      currency: "INR",
      recordDate: null,
      paymentDate: null,
    },
  ];
  if (section === "chart") return { candles, dividends, asOf: null };
  if (section === "dividends") return { dividends };
  if (section === "news")
    return {
      articles: [
        {
          title: `${company.name || company.symbol || "Example company"} announces quarterly results — illustrative sample`,
          publisher: "Fictional example",
          publishedAt: "2025-02-01T09:00:00Z",
          url: null,
        },
      ],
    };
  return {
    quarters: [
      {
        periodEnd: "2024-12-31",
        revenue: 10000000000,
        netIncome: 1200000000,
        eps: 12,
        currency: "INR",
      },
      {
        periodEnd: "2024-09-30",
        revenue: 9500000000,
        netIncome: 1100000000,
        eps: 11,
        currency: "INR",
      },
    ],
    nextEarningsDate: null,
  };
}
