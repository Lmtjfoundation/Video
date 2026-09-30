using UnrealBuildTool;
using System.Collections.Generic;

public class SouthernHeatTarget : TargetRules
{
	public SouthernHeatTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("SouthernHeat");
	}
}
