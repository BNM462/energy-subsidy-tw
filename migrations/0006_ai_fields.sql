-- AI 整理的卡片欄位（補助重點、最高補助、金額明細、補助對象；JSON），以及整理時的公告內容雜湊（內容變動才重新整理）
ALTER TABLE subsidies ADD COLUMN ai_fields TEXT;
ALTER TABLE subsidies ADD COLUMN ai_hash TEXT;
