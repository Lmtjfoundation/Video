// Canvas HUD: minimap with GPS route, wanted stars, money, health, weapon,
// zone names, mission text, big WASTED/BUSTED messages and the full map.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "SHHUD.generated.h"

class ASHGameMode;
class UFont;

UCLASS()
class SOUTHERNHEAT_API ASHHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;
	bool MapScreenToWorld(float X, float Y, FVector2D& OutWorld) const;

private:
	void Txt(const FString& Str, float X, float Y, const FLinearColor& C, UFont* Font, float Scale, int32 Align = 0);
	void DrawMinimap(ASHGameMode* GM, float S);
	void DrawStatus(ASHGameMode* GM, float S);
	void DrawMessages(ASHGameMode* GM, float S);
	void DrawBigMap(ASHGameMode* GM, float S);
	void ClippedLine(FVector2D A, FVector2D B, const FVector4& Rect, const FLinearColor& C, float Thick);
	void UpdateRoute(ASHGameMode* GM);

	TArray<FVector2D> Route;
	float RouteTimer = 0.f;
	FVector4 MapRect;   // x, y, w, h of the full map in screen pixels
	float MapScale = 1.f;
	float CamYaw = 0.f;
};
