import { initializeDatabase } from "./db.js";
import { seedDemoData } from "./demoSeed.js";

initializeDatabase();

if (seedDemoData()) {
  console.log("已写入演示测试数据。");
} else {
  console.log("演示测试数据已存在，未重复写入。");
}
