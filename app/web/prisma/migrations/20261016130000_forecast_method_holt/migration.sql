-- 予測の手法に Holt（二重指数平滑）と Holt-Winters（季節つき）を足す。
-- これまでは列挙型に値が無く、保存すると LINEAR_REGRESSION に変わっていた。

-- AlterEnum
ALTER TYPE "ForecastMethod" ADD VALUE 'HOLT';
ALTER TYPE "ForecastMethod" ADD VALUE 'HOLT_WINTERS';
