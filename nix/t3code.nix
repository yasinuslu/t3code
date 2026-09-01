# T3 Code packaged from THIS tree, by rebuilding nixpkgs' own t3code derivation against
# it instead of against the upstream tag nixpkgs pins.
#
# WHY NOT JUST USE nixpkgs.t3code: nixpkgs tracks pingdotgg/t3code releases, so (a) it is
# always several patch versions behind an app that ships every few days, and (b) it can
# only ever build UPSTREAM, which is useless for a fork whose entire point is carrying
# local patches.
#
# WHY OVERRIDE RATHER THAN WRITE A FRESH DERIVATION: nixpkgs' packaging already solved the
# hard parts, and they are not obvious ones -- the vite host patch, the exact pnpm
# workspace list, ELECTRON_SKIP_BINARY_DOWNLOAD, dontPatchELF over the vendored native
# blobs, the Rust resource-monitor sidecar, the .desktop entry on Linux and a real
# `T3 Code (Alpha).app` bundle on darwin. overrideAttrs keeps every one of those and
# changes only the two things that must change: the source tree and the pnpm store hash.
#
# THE ONE HASH MANAGED BY HAND is `pnpmHash`. It covers the pnpm store for this tree's
# pnpm-lock.yaml, so it only moves when a DEPENDENCY moves -- an ordinary source commit
# leaves it alone. When it is wrong the build fails with a "got: sha256-..." line; paste
# that in. cargoHash for the resource-monitor comes from nixpkgs and only needs attention
# if native/resource-monitor/Cargo.lock changes.
{
  pkgs,

  # The tree to build. The flake passes `self`, so it is always exactly this commit.
  # A local path also works, for testing an uncommitted change.
  src,

  # Stamped onto the version so a running instance can be told apart from an upstream
  # release or a Homebrew copy at a glance -- `t3 --version` and the app's About box both
  # show it. The flake passes the short rev.
  versionSuffix ? "",

  pnpmHash ? "sha256-RH3YzOn4R3mSwEUGFgKVNR2RdeYSyjp1MZm5m5lb5cY=",
}:
let
  inherit (pkgs) lib;

  # nixpkgs builds the Rust resource-monitor sidecar out of the SAME tree, and finds it
  # with `sourceRoot = "${t3code-unwrapped.src.name}/native/resource-monitor"`. That works
  # when src is a fetchFromGitHub *derivation*, which carries a `name`; a flake's `self` is
  # a bare store path, which does not, and the whole build dies at eval with
  # `error: attribute 'name' missing`.
  #
  # Fix: hand the derivation an attrset that string-coerces to the same store path but also
  # carries a name -- the shape lib.cleanSourceWith produces. Doing it this way rather than
  # with builtins.path or cleanSourceWith avoids a second full copy of the repo in the
  # store, which would buy nothing.
  #
  # `name` must equal the directory stdenv's unpack phase produces, which it gets by
  # stripping the hash off the store path's basename -- always "source" for a flake input.
  # Computed rather than hardcoded so that passing a local checkout still works.
  srcPath = if lib.isAttrs src && src ? outPath then src.outPath else src;
  srcBase = baseNameOf (toString srcPath);
  namedSrc = {
    outPath = srcPath;
    name =
      if builtins.match "[0-9a-df-np-sv-z]{32}-.+" srcBase != null then
        builtins.substring 33 (-1) srcBase
      else
        srcBase;
  };

  # The monorepo root package.json carries no version; apps/desktop's does, and it is the
  # one upstream's own release tooling treats as canonical (see
  # scripts/update-release-package-versions.ts, which the build runs in preBuild).
  baseVersion = (lib.importJSON "${srcPath}/apps/desktop/package.json").version;

  # Semver PRERELEASE syntax (`-nepjua.abc1234`) rather than build metadata (`+abc1234`):
  # this string is written verbatim into four package.json files by upstream's version
  # script, and pnpm is far happier with a prerelease than with build metadata.
  version = if versionSuffix == "" then baseVersion else "${baseVersion}-${versionSuffix}";

  # pnpmDeps has to be REBUILT rather than overridden: its hash is an argument to the
  # fetcher, not an attribute of the derivation, so `overrideAttrs` cannot reach it.
  unwrapped = pkgs.t3code.unwrapped.overrideAttrs (old: {
    inherit version;
    src = namedSrc;

    pnpmDeps = pkgs.fetchPnpmDeps {
      pnpm = pkgs.pnpm_11;
      pname = "t3code-unwrapped";
      inherit version;
      src = namedSrc;
      inherit (old) pnpmWorkspaces;
      fetcherVersion = 4;
      hash = pnpmHash;
    };
  });
in
# The wrapper derivation reads t3code-unwrapped for both the app and the resource-monitor
# sidecar (its default argument threads the same value through), so overriding that one
# input moves the whole package.
(pkgs.t3code.override { t3code-unwrapped = unwrapped; }).overrideAttrs (old: {
  # symlinkJoin takes its name from pname/version, which the override does not carry over.
  inherit version;

  # TELEMETRY IS OFF, ENFORCED IN THE PACKAGE.
  #
  # T3 Code ships analytics ON by default: the server reads `T3CODE_TELEMETRY_ENABLED`
  # through Effect's Config with `withDefault(true)`, and carries a hardcoded PostHog
  # project key pointing at https://us.i.posthog.com. Installing through Nix changes none
  # of that, so the opt-out has to be applied here.
  #
  # `--set` rather than `--set-default` is deliberate. set-default would let any stray
  # value in the environment switch reporting back on; --set means the only way to
  # re-enable it is to edit this file.
  #
  # Each variable and who reads it:
  #   T3CODE_TELEMETRY_ENABLED   T3 Code's own PostHog reporting. The one that matters.
  #   T3CODE_POSTHOG_KEY/HOST    Blanked so that even if a future version ignores the
  #                              enable flag, there is no project key or endpoint left to
  #                              post to. Defence in depth against a default flipping back.
  #   DO_NOT_TRACK               The cross-vendor opt-out convention. T3 bundles Claude
  #                              Code's client, whose own check maps this to "no-telemetry".
  #   DISABLE_TELEMETRY          Same bundled check, second accepted spelling.
  #   CLERK_TELEMETRY_DISABLED   The Clerk auth SDK reports separately, to
  #                              clerk-telemetry.com.
  #   OTEL_SDK_DISABLED          Standard OpenTelemetry kill switch, for the agent CLIs
  #                              that this wrapper puts on T3's PATH.
  #
  # T3CODE_DISABLE_AUTO_UPDATE is set for a second reason as well as the phone-home: the
  # app lives on a read-only /nix/store path, so an in-app update could never succeed. It
  # would only ever nag. Version bumps happen through the flake, not through the app.
  #
  # Appended to buildCommand, NOT postBuild: symlinkJoin folds its `postBuild` ARGUMENT
  # into buildCommand at call time, so overriding the postBuild attr afterwards is
  # silently a no-op. This runs after nixpkgs' own wrapping pass, so the binaries end up
  # double-wrapped, which wrapProgram handles by suffixing the hidden name.
  buildCommand = old.buildCommand + ''
    for program in "$out"/bin/*; do
      wrapProgram "$program" \
        --set T3CODE_TELEMETRY_ENABLED false \
        --set T3CODE_POSTHOG_KEY "" \
        --set T3CODE_POSTHOG_HOST "" \
        --set T3CODE_DISABLE_AUTO_UPDATE 1 \
        --set DO_NOT_TRACK 1 \
        --set DISABLE_TELEMETRY 1 \
        --set CLERK_TELEMETRY_DISABLED 1 \
        --set OTEL_SDK_DISABLED true
    done
  '';

  passthru = (old.passthru or { }) // {
    inherit unwrapped;
    src = namedSrc;
    pnpmDeps = unwrapped.pnpmDeps;
  };
})
