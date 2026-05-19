import type { ViewLoadController, ViewLoadToken } from "../runtime/view-load-controller";

type MaybePromise<T> = T | Promise<T>;

export async function runViewLoad<View extends string, Result>(options: {
  controller: ViewLoadController<View>;
  view: View;
  loading?: boolean;
  afterBegin?: (token: ViewLoadToken<View>) => MaybePromise<void>;
  load: () => Promise<Result>;
  commit: (result: Result) => MaybePromise<void>;
  fail: (message: string) => MaybePromise<void>;
}) {
  const token = options.controller.begin(options.view, { loading: options.loading });
  try {
    await options.afterBegin?.(token);
    const result = await options.load();
    return await token.commit(() => options.commit(result));
  } catch (error) {
    return await token.fail(error, options.fail);
  } finally {
    token.finish();
  }
}
