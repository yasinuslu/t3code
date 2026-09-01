# Nix packaging for Yasin's T3 Code fork. Lives on the `nepjua` branch only; `main` stays
# a clean mirror of pingdotgg/t3code so upstream can always be fast-forwarded.
#
# This flake exists so that the ~/code/nepjua machine config can install THIS tree with a
# single `nix flake update t3code`, and so that .github/workflows/nix-desktop.yml can build
# the exact same derivation on a free public-repo runner and publish it to a binary cache.
# Source and packaging living in one repo is what keeps that to one bump instead of two:
# a commit here IS the new version.
#
# NIXPKGS IS PINNED HERE AND DELIBERATELY NOT `follows`-ed BY THE CONSUMER. The binary
# cache is keyed on the full derivation hash, so if the machine config forced its own
# nixpkgs into this flake, every nixpkgs bump on the machine side would change the hash,
# miss the cache, and put a ten-minute electron build back in front of every rebuild. The
# price of pinning is that electron/nodejs may be present in the store twice when the two
# pins drift; that is a few hundred MB, and it is the right trade.
{
  description = "T3 Code desktop, built from Yasin's fork with telemetry hard-disabled";

  inputs = {
    # Kept in step with ~/code/nepjua's own nixpkgs by hand, so the two closures share
    # electron and nodejs. Drifting is harmless, just wasteful.
    nixpkgs.url = "github:NixOS/nixpkgs/d2f67949798825fe853f7c5d0492b8bf016d3f88";
  };

  outputs =
    { self, nixpkgs }:
    let
      # The two systems Yasin actually runs: nika is x86_64-linux, joyboy and ichigo are
      # aarch64-darwin. Both are built by CI, so both substitute instead of compiling.
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;

      pkgsFor =
        system:
        import nixpkgs {
          inherit system;
          # electron is unfree on darwin (the prebuilt binary), so without this the Mac
          # build refuses to evaluate. Set here rather than expected from the caller: this
          # flake is imported by a machine config as a pre-evaluated package, so the
          # caller's nixpkgs.config never gets a say.
          config.allowUnfree = true;
        };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          t3code = import ./nix/t3code.nix {
            inherit pkgs;
            # `self` is this exact commit's tree, so the build is always in lockstep with
            # the packaging. On a dirty working tree there is no rev to stamp.
            src = self;
            versionSuffix = "nepjua.${self.shortRev or "dirty"}";
          };
        in
        {
          inherit t3code;
          default = t3code;
        }
      );

      formatter = forAllSystems (system: (pkgsFor system).nixfmt);
    };
}
