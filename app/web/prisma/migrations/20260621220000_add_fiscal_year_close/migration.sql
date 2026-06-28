-- F013 決算年度管理
CREATE TABLE "fiscal_year_closes" (
    "id"         SERIAL PRIMARY KEY,
    "fiscalYear" INTEGER       NOT NULL,
    "status"     TEXT          NOT NULL DEFAULT 'open',
    "netIncome"  DECIMAL(18,2),
    "closedAt"   TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("fiscalYear")
);
