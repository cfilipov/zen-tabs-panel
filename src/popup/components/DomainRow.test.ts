import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomainIndexRow } from "../runtime/tab-index-client";
import DomainRow from "./DomainRow.svelte";

afterEach(cleanup);

const row: DomainIndexRow = {
  kind: "domain",
  domain: "example.com",
  count: 7,
};

describe("DomainRow", () => {
  it("opens the close confirmation from the close affordance without activating the domain", async () => {
    const onactivate = vi.fn();
    const onclose = vi.fn();

    render(DomainRow, {
      props: {
        row,
        index: 3,
        onactivate,
        onclose,
      },
    });

    await fireEvent.click(screen.getByTitle("Close domain tabs"));

    expect(onclose).toHaveBeenCalledWith(row);
    expect(onactivate).not.toHaveBeenCalled();
  });
});
