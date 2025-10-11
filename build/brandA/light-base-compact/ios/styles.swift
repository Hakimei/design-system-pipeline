/*
 * Do not edit — auto-generated
 * on Sat, 11 Oct 2025, 13:02:37 GMT+7
 * 
 * Brand: brandA
 * Mode: light
 * Shape: base
 * Density: compact
 */

import SwiftUI

struct TextTitleStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: CGFloat(22.00), weight: .medium))
            .lineSpacing(1.3)
            .tracking(0)
    }
}

struct TextBodyStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: CGFloat(16.00), weight: .regular))
            .lineSpacing(1.5)
            .tracking(0)
    }
}
