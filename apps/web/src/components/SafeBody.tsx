import { EyeInvisibleOutlined, PictureOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Flex, Spin, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

interface Props {
  text: string | null;
  html?: string | null;
  loading?: boolean;
  remoteImageCount?: number;
  inlineImageCount?: number;
}

function prepareEmailHtml(html: string, showRemoteImages: boolean): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script,iframe,frame,object,embed,form,input,button,textarea,select,meta,base,link")
    .forEach((element) => element.remove());
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
    }
    if (element instanceof HTMLAnchorElement) element.removeAttribute("href");
  });
  document.querySelectorAll<HTMLImageElement>("img[data-remote-src]").forEach((image) => {
    const remoteSource = image.dataset.remoteSrc ?? "";
    if (showRemoteImages && /^https?:\/\//i.test(remoteSource)) image.src = remoteSource;
    else image.removeAttribute("src");
  });

  const imagePolicy = showRemoteImages ? "img-src data: http: https:" : "img-src data:";
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imagePolicy}; style-src 'unsafe-inline'; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
<style>
html,body{margin:0;padding:0;background:#fff;color:#202124;font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;overflow-wrap:anywhere}
body{padding:18px}img{max-width:100%!important;height:auto!important}table{max-width:100%!important;border-collapse:collapse}.mail-link-text{color:#2563eb;text-decoration:underline}
</style></head><body>${document.body.innerHTML}</body></html>`;
}

export function SafeBody({
  text,
  html = null,
  loading = false,
  remoteImageCount = 0,
  inlineImageCount = 0,
}: Props) {
  const [showRemoteImages, setShowRemoteImages] = useState(true);
  useEffect(() => setShowRemoteImages(true), [html]);
  const sourceDocument = useMemo(
    () => html ? prepareEmailHtml(html, showRemoteImages) : null,
    [html, showRemoteImages],
  );

  if (loading) return <div className="body-loading"><Spin tip="正在只读加载邮件正文…" /></div>;
  if (!sourceDocument && !text) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="邮件没有可显示的正文" />;

  return (
    <div className="safe-mail-content">
      {(remoteImageCount > 0 || inlineImageCount > 0) && (
        <Flex className="image-controls" align="center" wrap gap={8}>
          {inlineImageCount > 0 && <Tag color="green">已显示 {inlineImageCount} 张内嵌图片</Tag>}
          {remoteImageCount > 0 && (
            <Button
              size="small"
              aria-label={showRemoteImages ? "隐藏外链图片" : `显示 ${remoteImageCount} 张外链图片`}
              icon={showRemoteImages ? <EyeInvisibleOutlined /> : <PictureOutlined />}
              onClick={() => setShowRemoteImages((current) => !current)}
            >
              {showRemoteImages ? "隐藏外链图片" : `显示 ${remoteImageCount} 张外链图片`}
            </Button>
          )}
          {remoteImageCount > 0 && !showRemoteImages && (
            <Typography.Text type="secondary">外链图片已隐藏</Typography.Text>
          )}
        </Flex>
      )}
      {sourceDocument ? (
        <iframe
          className="safe-mail-frame"
          title="邮件 HTML 正文"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={sourceDocument}
        />
      ) : (
        <Typography.Paragraph className="safe-body" aria-label="邮件纯文本正文">
          {text}
        </Typography.Paragraph>
      )}
      {showRemoteImages && remoteImageCount > 0 && (
        <Alert
          className="remote-image-warning"
          type="warning"
          showIcon
          message="外链图片已自动加载，可能包含追踪像素"
        />
      )}
    </div>
  );
}
