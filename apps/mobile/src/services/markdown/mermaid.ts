/**
 * 移动端 v1 暂不打包 Mermaid（依赖体积大、首次加载慢）。
 * 保留接口，渲染 Mermaid 图时给出失败状态，不影响普通 Markdown。
 */
export const renderMermaid = async (
  _code: string,
  _dark: boolean,
  _isCancelled: () => boolean
): Promise<string | null> => {
  throw new Error('Mermaid diagrams are not supported in this build')
}
