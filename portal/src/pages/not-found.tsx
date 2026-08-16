/**
 * A route inside the shell that does not exist.
 *
 * Its own module, and that is a bundling decision rather than a taste: the 404
 * is reachable from every route, so importing it eagerly from `screens.tsx`
 * would pull all six record screens into the entry chunk and undo the split in
 * App.tsx.
 */
export function NotFoundScreen() {
  return (
    <div className="grid min-h-[50dvh] place-items-center text-center">
      <div>
        <p className="num text-3xl text-signal">404</p>
        <p className="mt-2 text-sm text-haze">That screen does not exist in the portal.</p>
        <a href="/portal/" className="mt-4 inline-block text-xs underline underline-offset-4 hover:text-paper">
          Back to the Dashboard
        </a>
      </div>
    </div>
  );
}
