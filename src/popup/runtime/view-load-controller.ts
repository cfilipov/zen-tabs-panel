type MaybePromise<T> = T | Promise<T>;

export type ViewLoadToken<View extends string> = {
  id: number;
  view: View;
  isCurrent: () => boolean;
  commit: (apply: () => MaybePromise<void>) => Promise<boolean>;
  fail: (error: unknown, apply: (message: string) => MaybePromise<void>) => Promise<boolean>;
  finish: () => boolean;
};

export type ViewLoadController<View extends string> = {
  begin: (view: View, options?: { loading?: boolean }) => ViewLoadToken<View>;
  invalidate: () => number;
  errorMessage: (error: unknown) => string;
  readonly generation: number;
};

type ViewLoadControllerOptions<View extends string> = {
  getCurrentView: () => View;
  setCurrentView: (view: View) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  errorMessage?: (error: unknown) => string;
};

export function createViewLoadController<View extends string>(
  options: ViewLoadControllerOptions<View>,
): ViewLoadController<View> {
  let generation = 0;
  const errorMessage = options.errorMessage ?? ((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  );

  function token(id: number, view: View): ViewLoadToken<View> {
    const isCurrent = () => id === generation && options.getCurrentView() === view;
    return {
      id,
      view,
      isCurrent,
      async commit(apply) {
        if (!isCurrent()) return false;
        await apply();
        return true;
      },
      async fail(error, apply) {
        if (!isCurrent()) return false;
        await apply(errorMessage(error));
        return true;
      },
      finish() {
        if (!isCurrent()) return false;
        options.setLoading(false);
        return true;
      },
    };
  }

  return {
    begin(view, beginOptions = {}) {
      generation += 1;
      options.setCurrentView(view);
      options.setError(null);
      options.setLoading(beginOptions.loading !== false);
      return token(generation, view);
    },
    invalidate() {
      generation += 1;
      return generation;
    },
    errorMessage,
    get generation() {
      return generation;
    },
  };
}
