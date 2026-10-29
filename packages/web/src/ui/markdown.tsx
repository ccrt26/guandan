import { type ReactNode } from 'react';

/**
 * 极简 Markdown 渲染（标题/加粗/列表/段落），无外部依赖。
 * 支持 [[MOVE:N]] 占位符：文本被切成段，占位符处插入调用方提供的复现卡组件。
 */
export function Markdown({
  text, renderSlot,
}: {
  text: string;
  /** 处理 [[MOVE:N]] 占位符，返回要渲染的组件 */
  renderSlot?: (slot: string, value: string) => ReactNode;
}) {
  const parts = text.split(/(\[\[MOVE:\d+\]\])/g);
  return (
    <div className="md">
      {parts.map((part, i) => {
        const m = part.match(/^\[\[MOVE:(\d+)\]\]$/);
        if (m && renderSlot) return <div key={i}>{renderSlot('MOVE', m[1])}</div>;
        return <MarkdownBlock key={i} text={part} />;
      })}
    </div>
  );
}

function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={key}>
        {listItems.map((item, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: inline(item) }} />
        ))}
      </ul>,
    );
    listItems = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^#{1,3}\s/.test(line)) {
      flushList(`l${idx}`);
      const level = line.match(/^#+/)![0].length;
      const content = line.replace(/^#+\s*/, '');
      blocks.push(
        level === 1 ? <h2 key={idx} dangerouslySetInnerHTML={{ __html: inline(content) }} />
        : level === 2 ? <h3 key={idx} dangerouslySetInnerHTML={{ __html: inline(content) }} />
        : <h4 key={idx} dangerouslySetInnerHTML={{ __html: inline(content) }} />,
      );
    } else if (/^[-*]\s+/.test(line)) {
      listItems.push(line.replace(/^[-*]\s+/, ''));
    } else if (line.trim() === '') {
      flushList(`l${idx}`);
    } else if (/^>\s?/.test(line)) {
      flushList(`l${idx}`);
      blocks.push(<blockquote key={idx} dangerouslySetInnerHTML={{ __html: inline(line.replace(/^>\s?/, '')) }} />);
    } else {
      flushList(`l${idx}`);
      blocks.push(<p key={idx} dangerouslySetInnerHTML={{ __html: inline(line) }} />);
    }
  });
  flushList('last');
  return <>{blocks}</>;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/【([^】]+)】/g, '<span class="kp">【$1】</span>');
}
