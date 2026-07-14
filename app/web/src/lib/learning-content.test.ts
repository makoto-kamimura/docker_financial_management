import { describe, expect, it } from "vitest";
import { TOPIC_KEYS, loadTopic, loadTopicSummaries } from "./learning-content";

describe("learning-content", () => {
  it("5 トピックが定義されている", () => {
    expect(TOPIC_KEYS.length).toBe(5);
  });

  it("loadTopicSummaries はタイトル・順序を持つ一覧を order 昇順で返す", () => {
    const summaries = loadTopicSummaries();
    expect(summaries).toHaveLength(5);
    for (const s of summaries) {
      expect(s.title.length).toBeGreaterThan(0);
    }
    const orders = summaries.map((s) => s.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("loadTopic は本文 HTML を含む単一トピックを返す", () => {
    const topic = loadTopic(TOPIC_KEYS[0]);
    expect(topic).not.toBeNull();
    expect(topic?.html.length).toBeGreaterThan(0);
    expect(topic?.html).toContain("<h2>");
  });

  it("loadTopic は未知の key に対して null を返す", () => {
    expect(loadTopic("../../../etc/passwd")).toBeNull();
    expect(loadTopic("nonexistent-topic")).toBeNull();
  });
});
