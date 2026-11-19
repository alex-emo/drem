import type { VersionInfo } from "../lib/branches";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";

export default function BranchSwitcher({
  versions,
  disabled,
  onSelect,
}: {
  versions: VersionInfo;
  disabled: boolean;
  onSelect: (messageId: string) => void;
}) {
  if (versions.ids.length <= 1) return null;
  const { ids, index } = versions;
  return (
    <div className="branch-switcher" aria-label="消息版本">
      <button
        type="button"
        className="icon-btn small"
        aria-label="上一个版本"
        title="上一个版本"
        disabled={disabled || index <= 0}
        onClick={() => onSelect(ids[index - 1])}
      >
        <ChevronLeftIcon size={14} />
      </button>
      <span className="branch-count">
        {index + 1} / {ids.length}
      </span>
      <button
        type="button"
        className="icon-btn small"
        aria-label="下一个版本"
        title="下一个版本"
        disabled={disabled || index >= ids.length - 1}
        onClick={() => onSelect(ids[index + 1])}
      >
        <ChevronRightIcon size={14} />
      </button>
    </div>
  );
}
