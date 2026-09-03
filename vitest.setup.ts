import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library only auto-cleans when vitest runs with globals enabled, which
// this project doesn't. Without this every render piles up in the same document
// and `screen` queries start matching the previous test's markup.
afterEach(cleanup);
