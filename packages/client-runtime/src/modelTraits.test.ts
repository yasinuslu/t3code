import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildTraitsTriggerDisplay, getDescriptorStringValue } from "./modelTraits.ts";

describe("buildTraitsTriggerDisplay", () => {
  it.each([
    { currentValue: undefined, defaultValue: undefined, value: null, label: "Thinking" },
    { currentValue: undefined, defaultValue: "high", value: "high", label: "High" },
    { currentValue: "low", defaultValue: undefined, value: "low", label: "Low" },
    { currentValue: "max", defaultValue: "high", value: "max", label: "Max" },
    { id: "effort", currentValue: undefined, defaultValue: undefined, value: null, label: "" },
  ])("labels Pi thinking without inventing a selection: $label ($value)", (input) => {
    const descriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
      id: input.id ?? "thinking",
      label: "Thinking",
      type: "select",
      options: ["low", "high", "max"].map((id) => ({
        id,
        label: id[0]!.toUpperCase() + id.slice(1),
        ...(id === input.defaultValue ? { isDefault: true } : {}),
      })),
      ...(input.currentValue ? { currentValue: input.currentValue } : {}),
    };

    expect(
      buildTraitsTriggerDisplay({
        descriptors: [descriptor],
        primarySelectDescriptorId: descriptor.id,
        ultrathinkPromptControlled: false,
      }).label,
    ).toBe(input.label);
    expect(getDescriptorStringValue(descriptor)).toBe(input.value);
  });
});

describe("buildTraitsTriggerDisplay auto-compact", () => {
  it.each([
    [undefined, "High"],
    ["600000", "High · Compact 600K"],
  ])("shows the auto-compact window only when the thread sets one (%s)", (currentValue, label) => {
    const effort: ProviderOptionDescriptor = {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "high", label: "High", isDefault: true }],
    };
    const autoCompact: ProviderOptionDescriptor = {
      id: "autoCompactWindow",
      label: "Auto-compact at",
      type: "select",
      options: [
        { id: "default", label: "Profile default", isDefault: true },
        { id: "600000", label: "600K" },
      ],
      ...(currentValue ? { currentValue } : {}),
    };
    expect(
      buildTraitsTriggerDisplay({
        descriptors: [effort, autoCompact],
        primarySelectDescriptorId: "effort",
        ultrathinkPromptControlled: false,
      }).label,
    ).toBe(label);
  });
});
