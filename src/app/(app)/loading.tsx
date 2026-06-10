// Shown while a server component in the app shell streams its data.
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" aria-label="Loading" role="status">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand" />
    </div>
  );
}
