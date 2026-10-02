-- 卡片顯示的期間文字（例：第四梯 2026/10/01 ～ 10/30 17:00），由爬蟲依官方梯次表產生
ALTER TABLE subsidies ADD COLUMN period_text TEXT;
