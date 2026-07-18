export function SteamIcon({ title }: { title?: string }) {
  return (
    <svg viewBox="0 0 24 24" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-9.8 8.05l5.33 2.2a2.83 2.83 0 0 1 1.62-.5l2.37-3.44v-.05a3.76 3.76 0 1 1 3.76 3.76h-.08l-3.39 2.42a2.85 2.85 0 0 1-5.5 1.09l-3.82-1.58A10 10 0 1 0 12 2Zm-3.01 13.94-1.23-.51a2.11 2.11 0 1 0 1.15-2.75l1.28.53a1.58 1.58 0 1 1-1.2 2.73Zm6.29-5.18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm0-.63a1.87 1.87 0 1 1 0-3.74 1.87 1.87 0 0 1 0 3.74Z"
      />
    </svg>
  );
}
