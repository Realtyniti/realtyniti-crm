"use client";

import { startTransition, type FormEvent } from "react";

/**
 * React clears a form after its action runs, which would wipe what someone typed when the server
 * says "try again". Submitting through this keeps the fields; without JavaScript the form's
 * own action still works.
 */
export function keepFields(dispatch: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
}
