-- 申請期間依類別／梯次不同（顯示「依類別不同」）
ALTER TABLE subsidies ADD COLUMN period_varies INTEGER NOT NULL DEFAULT 0;
