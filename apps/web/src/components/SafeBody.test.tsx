import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SafeBody } from "./SafeBody.js";

describe("SafeBody", () => {
  it("renders plain text as text rather than markup", () => {
    const text = '<img src="https://tracker.invalid/pixel">请确认账单';
    const { container } = render(<SafeBody text={text} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("isolates HTML, loads remote images by default and allows hiding them", () => {
    render(
      <SafeBody
        text="fallback"
        html={'<p>正文</p><script>bad()</script><img data-remote-src="https://tracker.invalid/pixel.png">'}
        remoteImageCount={1}
      />,
    );
    const frame = screen.getByTitle("邮件 HTML 正文");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame.getAttribute("srcdoc")).not.toContain("<script");
    expect(frame.getAttribute("srcdoc")).toMatch(/<img[^>]*\ssrc="https:\/\/tracker\.invalid\/pixel\.png"/);

    fireEvent.click(screen.getByRole("button", { name: "隐藏外链图片" }));
    expect(frame.getAttribute("srcdoc")).not.toMatch(/<img[^>]*\ssrc="https:\/\/tracker\.invalid\/pixel\.png"/);
  });
});
