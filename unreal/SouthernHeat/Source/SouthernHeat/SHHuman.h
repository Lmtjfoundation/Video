// Jointed humanoid built from engine primitive shapes (no skeletal mesh or
// animation assets needed). Hips, knees, shoulders and elbows are animated in code.
#pragma once

#include "CoreMinimal.h"

class AActor;
class USceneComponent;
class UStaticMeshComponent;

struct FSHLook
{
	FLinearColor Skin, Shirt, Pants, Hair, Shoes, HatColor;
	int32 Hat = 0;          // 0 none, 1 police cap, 2 cowboy hat, 3 baseball cap
	int32 HairStyle = 0;    // 0 short, 1 long, 2 bun, 3 bald, 4 curly
	bool bFemale = false;
	bool bArmed = false;
	bool bShortSleeves = true;
	bool bSkirt = false;
	bool bVest = false;
	bool bBeads = false;
	float Height = 1.f;
	float Build = 1.f;

	static FSHLook Random(int32 City);
	static FSHLook Cop();
	static FSHLook Swat();
	static FSHLook Gang(const FLinearColor& Color);
	static FSHLook Player();
};

struct FSHHumanRig
{
	USceneComponent* Root = nullptr;
	USceneComponent* Torso = nullptr;
	USceneComponent* HipL = nullptr;
	USceneComponent* HipR = nullptr;
	USceneComponent* KneeL = nullptr;
	USceneComponent* KneeR = nullptr;
	USceneComponent* ShoulderL = nullptr;
	USceneComponent* ShoulderR = nullptr;
	USceneComponent* ElbowL = nullptr;
	USceneComponent* ElbowR = nullptr;
	UStaticMeshComponent* Gun = nullptr;
	float Phase = 0.f;

	// Builds the rig under Parent; the rig's origin is at the feet.
	void Build(AActor* Owner, USceneComponent* Parent, const FSHLook& Look);
	// Amount 0 = idle, ~1 = sprint
	void Animate(float Dt, float SpeedCmS, bool bAiming, bool bSwimming = false);
	void Punch(float T);
	void LieDown();
	void StandUp();
};
