import { test as base, expect } from "@playwright/test";
import { type MockRoutes, mockNetwork } from "./helpers/mockNetwork";

interface Fixtures {
  mockRoutes: MockRoutes;
}

// Every non-live test gets the network mocked automatically, and fails if
// the app tried to reach any host that is not mocked.
export const test = base.extend<Fixtures>({
  mockRoutes: [{}, { option: true }],
  page: async ({ page, mockRoutes }, use) => {
    const mock = await mockNetwork(page, mockRoutes);
    await use(page);
    mock.expectNoUnmockedRequests();
  },
});

export { expect };
