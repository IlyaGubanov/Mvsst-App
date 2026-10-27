-- =====================================================================
--  Миграция 002 — поля, найденные при переносе данных из старых HTML-модулей.
--  Применяется командой:  npm run migrate   (из папки server/)
--  На новой установке НЕ нужна: эти изменения уже есть в database/schema.sql.
-- =====================================================================

-- Школы: в закупках, кроме производителя, указан поставщик
ALTER TABLE sch_object_materials
  ADD COLUMN supplier VARCHAR(150) NULL COMMENT 'поставщик' AFTER maker;

-- МКД: у недельного статуса позиции бывает примечание
ALTER TABLE mkd_item_status
  ADD COLUMN note VARCHAR(1000) NULL COMMENT 'примечание к статусу за период' AFTER paid_amount;

-- Сети: в графах документов встречаются тексты длиннее 20 символов
-- («выход тех часть без смет превышение», «02.09.2026 зайдут превышение»)
ALTER TABLE net_objects
  MODIFY doc_psd    VARCHAR(100) NULL,
  MODIFY doc_dwg    VARCHAR(100) NULL,
  MODIFY doc_mge    VARCHAR(100) NULL,
  MODIFY doc_sogl   VARCHAR(100) NULL,
  MODIFY doc_sogl_g VARCHAR(100) NULL;

-- Благоустройство: дополнительные столбцы строки отчёта («№», «Комплекс» …)
ALTER TABLE st_report_objects
  ADD COLUMN source_meta JSON NULL COMMENT 'прочие столбцы строки из Excel' AFTER remarks;

-- Благоустройство: второй столбец факта «a» (в части отчётов факт записан в нём).
-- В расчёте готовности пока не участвует — как в исходном модуле.
ALTER TABLE st_report_values
  ADD COLUMN alt_fact_volume DECIMAL(14,3) NULL COMMENT 'второй столбец факта (a) из отчёта' AFTER fact_volume;
