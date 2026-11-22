/* 兼容 Android 10 自带 WebView（Chrome 74-83）缺失的内建方法。 */
type AtFn = (index: number) => unknown;

if (!(Array.prototype as unknown as { at?: AtFn }).at) {
  Object.defineProperty(Array.prototype, "at", {
    value(this: unknown[], index: number) {
      const length = this.length;
      const relative = Math.trunc(index) || 0;
      const resolved = relative < 0 ? length + relative : relative;
      return resolved < 0 || resolved >= length ? undefined : this[resolved];
    },
    writable: true,
    configurable: true,
  });
}

if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, "replaceAll", {
    value(this: string, search: string | RegExp, replacement: string) {
      if (search instanceof RegExp) {
        const flags = search.flags.includes("g") ? search.flags : `${search.flags}g`;
        return this.replace(new RegExp(search.source, flags), replacement);
      }
      return this.split(search).join(replacement);
    },
    writable: true,
    configurable: true,
  });
}

if (!Object.hasOwn) {
  Object.defineProperty(Object, "hasOwn", {
    value(object: object, property: PropertyKey) {
      return Object.prototype.hasOwnProperty.call(object, property);
    },
    writable: true,
    configurable: true,
  });
}
