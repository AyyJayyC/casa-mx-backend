import { describe, it, expect } from "vitest";
import { publicPropertyView } from "../src/utils/publicProperty.js";

describe("publicPropertyView", () => {
  it("strips the publisher external id", () => {
    const view = publicPropertyView({
      id: "p1",
      title: "Casa",
      externalId: "publisher-ref-123",
    });
    expect(view.externalId).toBeUndefined();
  });

  it("still strips address, seller and postal code", () => {
    const view = publicPropertyView({
      id: "p1",
      address: "Calle 1",
      codigoPostal: "06700",
      sellerId: "u1",
      title: "Casa",
    });
    expect(view.address).toBeUndefined();
    expect(view.codigoPostal).toBeUndefined();
    expect(view.sellerId).toBeUndefined();
    expect(view.title).toBe("Casa");
  });

  it("rounds coordinates to roughly 100 m", () => {
    const view = publicPropertyView({ id: "p1", lat: 19.432608, lng: -99.133209 });
    expect(view.lat).toBe(19.433);
    expect(view.lng).toBe(-99.133);
  });
});
