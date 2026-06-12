#!/usr/bin/env bash
set -euo pipefail

root="$HOME/agent/openclaw/apps/macos/.build/arm64/checkouts/swiftui-math/Sources/SwiftUIMath"

math="$root/Math.swift"
rendering="$root/RenderingMode.swift"
typesetting="$root/TypesettingStyle.swift"
font="$root/Font.swift"

if [[ ! -f "$math" || ! -f "$rendering" || ! -f "$typesetting" || ! -f "$font" ]]; then
  echo "swiftui-math checkout is missing" >&2
  exit 1
fi

chmod u+w "$math" "$rendering" "$typesetting" "$font"

if ! grep -q '#if false' "$math"; then
  perl -0pi -e 's/\n#Preview\("Display Style"\)/\n#if false\n#Preview("Display Style")/' "$math"
fi
if ! grep -q '#endif' "$math"; then
  printf '\n#endif\n' >> "$math"
fi

cat > "$rendering" <<'SWIFT'
import SwiftUI

extension Math {
  /// Controls how colors are applied when rendering math.
  public enum RenderingMode: Sendable {
    /// Draws all glyphs using the view's foreground style.
    case monochrome
    /// Honors LaTeX color commands and uses the base color for uncolored glyphs.
    case multicolor(base: SwiftUI.Color)

    /// Multicolor rendering using the view's primary color as the base.
    public static var multicolor: Self {
      .multicolor(base: .primary)
    }
  }
}

extension View {
  /// Sets the rendering mode for ``Math`` views in this hierarchy.
  public func mathRenderingMode(_ mathRenderingMode: Math.RenderingMode) -> some View {
    environment(\.mathRenderingMode, mathRenderingMode)
  }
}

private struct MathRenderingModeKey: EnvironmentKey {
  static let defaultValue: Math.RenderingMode = .monochrome
}

extension EnvironmentValues {
  var mathRenderingMode: Math.RenderingMode {
    get { self[MathRenderingModeKey.self] }
    set { self[MathRenderingModeKey.self] = newValue }
  }
}
SWIFT

cat > "$typesetting" <<'SWIFT'
import SwiftUI

extension Math {
  /// Controls how math is typeset (display vs inline text).
  public enum TypesettingStyle: Sendable {
    /// Display style for standalone equations.
    case display
    /// Text style for inline math.
    case text
  }
}

extension View {
  /// Sets the typesetting style for ``Math`` views in this hierarchy.
  public func mathTypesettingStyle(_ typesettingStyle: Math.TypesettingStyle) -> some View {
    environment(\.mathTypesettingStyle, typesettingStyle)
  }
}

private struct MathTypesettingStyleKey: EnvironmentKey {
  static let defaultValue: Math.TypesettingStyle = .display
}

extension EnvironmentValues {
  var mathTypesettingStyle: Math.TypesettingStyle {
    get { self[MathTypesettingStyleKey.self] }
    set { self[MathTypesettingStyleKey.self] = newValue }
  }
}
SWIFT

cat > "$font" <<'SWIFT'
import SwiftUI

extension Math {
  /// Identifies a math font and size used for typesetting.
  public struct Font: Hashable, Sendable {
    /// Known math font names bundled with the package.
    public struct Name: Hashable, Sendable, RawRepresentable, ExpressibleByStringLiteral {
      /// The raw font name used in the bundle.
      public let rawValue: String

      /// Creates a name from a raw font string.
      public init(rawValue: String) {
        self.rawValue = rawValue
      }

      /// Creates a name from a string literal.
      public init(stringLiteral value: StringLiteralType) {
        self.rawValue = value
      }
    }

    /// The bundled font name.
    public let name: Name
    /// The font size in points.
    public let size: CGFloat

    /// Creates a font configuration.
    public init(name: Name, size: CGFloat) {
      self.name = name
      self.size = size
    }
  }
}

extension Math.Font.Name {
  /// Latin Modern Math.
  public static let latinModern: Self = "latinmodern-math"
  /// KpMath Light.
  public static let kpMathLight: Self = "KpMath-Light"
  /// KpMath Sans.
  public static let kpMathSans: Self = "KpMath-Sans"
  /// XITS Math.
  public static let xits: Self = "xits-math"
  /// TeX Gyre Termes Math.
  public static let termes: Self = "texgyretermes-math"
  /// Asana Math.
  public static let asana: Self = "Asana-Math"
  /// Euler Math.
  public static let euler: Self = "Euler-Math"
  /// Fira Math.
  public static let fira: Self = "FiraMath-Regular"
  /// Noto Sans Math.
  public static let notoSans: Self = "NotoSansMath-Regular"
  /// Libertinus Math.
  public static let libertinus: Self = "LibertinusMath-Regular"
  /// Garamond Math.
  public static let garamond: Self = "Garamond-Math"
  /// Lete Sans Math.
  public static let leteSans: Self = "LeteSansMath"
}

extension View {
  /// Sets the math font used by ``Math`` views in this hierarchy.
  public func mathFont(_ font: Math.Font) -> some View {
    environment(\.mathFont, font)
  }
}

private struct MathFontKey: EnvironmentKey {
  static let defaultValue = Math.Font(name: .latinModern, size: 20)
}

extension EnvironmentValues {
  var mathFont: Math.Font {
    get { self[MathFontKey.self] }
    set { self[MathFontKey.self] = newValue }
  }
}
SWIFT

echo "swiftui-math patched for CommandLineTools-only build"
perl -0pi -e 's/^(\s+)(?!nonisolated\(unsafe\)\s+)static let defaultValue/$1nonisolated(unsafe) static let defaultValue/mg' "$font" "$rendering" "$typesetting"
